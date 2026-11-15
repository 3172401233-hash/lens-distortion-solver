# lens-distortion-solver

Node.js 镜头畸变求解库，支持 **Brown-Conrady 径向/切向模型**与**可配置 Kannala-Brandt
风格鱼眼模型**，提供正向投影、带收敛保证的逆向迭代求解与反向误差估计。

逆解使用牛顿-拉夫逊迭代并带解析雅可比，必须显式配置收敛阈值与最大迭代次数；
当参数不可逆、雅可比奇异或迭代耗尽时抛出 `DistortionError`，**不会静默返回原坐标**。

## 安装与测试

```bash
npm test        # 等价于 node --test
```

无运行时依赖，要求 Node.js >= 18（使用内置 `node:test`）。

## 坐标约定

### 输入输出坐标

- 公开 API 的 `u`、`v` 为**归一化像素坐标**，原点在图像**左上角**，
  `u` 向右、`v` 向下，画面范围为 `[0, 1] × [0, 1]`。
- 允许传入 `[0,1]` 之外的点（越界不报错），用于屏幕拾取射线延伸到画面外的场景。
- `width`、`height` 为像素尺寸，仅用于归一化坐标与镜头坐标之间的换算。

### 内部镜头坐标

畸变模型在镜头归一化平面（针孔相机坐标系、`z=1`）上求解：

```
x = (u * width  - cx) / f
y = (v * height - cy) / f
```

- 原点为光心 `(cx, cy)`，默认取图像中心 `(width/2, height/2)`。
- `f` 为焦距（像素单位），默认取 `width`；可通过 `focalLength` 覆盖，
  也可用 `principalPoint: { x, y }` 偏移光心。
- 镜头坐标是无量纲的归一化量；逆解容差 `tolerance` 作用在镜头坐标上，
  默认 `1e-10`。

### 误差估计的单位

`estimateInverseError` 同时给出三种残差：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `residualLens` | 镜头归一化坐标 | 逆解重投影后在镜头平面上的欧氏残差 |
| `residualNormalized` | 归一化像素坐标 | 与输入 `u/v` 同尺度，画面宽为 1 |
| `residualPixels` | 像素 | 以 `focalLength` 换算回物理像素的残差 |

## 支持的模型

### Brown-Conrady（`model: 'brown-conrady'`）

OpenCV `calibrateCamera` 使用的 plumb-bob 模型，含 3 个径向项与 2 个切向项：

```
r² = x² + y²
x_d = x(1 + k1 r² + k2 r⁴ + k3 r⁶) + 2 p1 x y + p2 (r² + 2x²)
y_d = y(1 + k1 r² + k2 r⁴ + k3 r⁶) + p1 (r² + 2y²) + 2 p2 x y
```

- 系数对象：`{ k1, k2, p1, p2, k3 }`，缺省项为 0。
- 也接受数组：5 元素按 OpenCV 顺序 `[k1, k2, p1, p2, k3]`；
  4 元素为 `[k1, k2, p1, p2]`。
- 适用于普通广角/针孔镜头。`k1 < 0` 表现为桶形畸变，`k1 > 0` 为枕形畸变。
- 强径向系数会使径向映射折叠（雅可比行列式变号），折叠区域内的目标点
  没有真实预图像，逆解将耗尽迭代并抛出 `MAX_ITERATIONS`。

### 可配置鱼眼（`model: 'fisheye'`）

Kannala-Brandt 风格的角度多项式模型，先由基底投影把镜头半径转为入射角
`theta`，再施加四阶角度畸变：

```
thetaD = theta (1 + k1 theta² + k2 theta⁴ + k3 theta⁶ + k4 theta⁸)
r_d     = projection.thetaFn(thetaD)
(x_d, y_d) = r_d / r · (x, y)
```

系数对象或 1–4 元素数组：`{ k1, k2, k3, k4 }`。`projection` 可选：

| projection | 基底关系 r(theta) | 定义域 | 备注 |
| --- | --- | --- | --- |
| `equidistant`（默认） | `r = theta` | 无有限上限 | 等距投影；零系数时为恒等映射，等价 OpenCV `fisheye` 模型 |
| `stereographic` | `r = 2 tan(theta/2)` | 无有限上限 | 体视投影 |
| `equisolid` | `r = 2 sin(theta/2)` | `r < 2` | 等立体角投影，越界抛 `OUT_OF_DOMAIN` |
| `orthographic` | `r = sin(theta)` | `r < 1` | 正交投影，越界抛 `OUT_OF_DOMAIN` |

注意鱼眼的多项式作用在 **theta（角度）** 上，与 Brown-Conrady 作用在
**r²（半径平方）** 上不同，因此同号系数的位移方向可能相反，不能混用两组系数。

## API

```js
const { distort, undistort, estimateInverseError, DistortionError } =
  require('lens-distortion-solver');

const options = {
  model: 'brown-conrady',          // 或 'fisheye'
  width: 1280,
  height: 720,
  coefficients: { k1: -0.28, k2: 0.09, p1: 0.001, p2: -0.002, k3: 0.04 },
  // focalLength: 1280,            // 缺省 = width
  // principalPoint: { x: 640, y: 360 },
  tolerance: 1e-10,                // 逆解收敛阈值（镜头坐标单位），必须为正数
  maxIterations: 50,               // 逆解最大迭代次数，必须为正整数
};

// 正向：未畸变归一化坐标 -> 畸变后坐标
const d = distort(0.12, 0.88, options);
// { u, v, lens: { x, y } }

// 逆向：屏幕拾取点 -> 未畸变相机空间坐标
const back = undistort(d.u, d.v, options);
// { u, v, lens: { x, y }, iterations, residual, converged,
//   tolerance, maxIterations }

// 反向误差估计：对逆解再次正向投影并量化残差
const error = estimateInverseError(d.u, d.v, options);
// { residualLens, residualNormalized, residualPixels,
//   iterations, converged, reprojected: { u, v } }
```

鱼眼示例：

```js
const fisheyeOptions = {
  model: 'fisheye',
  width: 1280,
  height: 720,
  projection: 'equisolid',
  coefficients: [0.04, -0.012, 0.003, -0.0005],
  tolerance: 1e-12,
  maxIterations: 100,
};
```

## 错误处理

所有失败统一抛出 `DistortionError`，通过 `code` 区分，`details` 携带迭代上下文：

| code | 触发条件 |
| --- | --- |
| `NON_FINITE` | 输入坐标、系数为 `NaN`/`Infinity`，或迭代产生非有限步长 |
| `INVALID_OPTION` | 未知模型/投影名、非法尺寸、容差或迭代次数 |
| `OUT_OF_DOMAIN` | 鱼眼基底投影的定义域不足（如正交投影 `r >= 1`） |
| `SINGULAR_JACOBIAN` | 迭代点雅可比行列式接近零，映射在该区域不可逆 |
| `MAX_ITERATIONS` | 达到 `maxIterations` 残差仍大于 `tolerance` |

库保证：任何不可逆或不收敛的情形都显式抛错，调用方不会拿到"原样返回"的坐标。

## 目录结构

```
lib/
  index.js     公开 API 与坐标换算
  brown.js     Brown-Conrady 正向投影与解析雅可比
  fisheye.js   可配置鱼眼正向投影与解析雅可比
  solver.js    牛顿-拉夫逊通用逆解器
  geometry.js  选项解析、镜头/像素坐标换算、鱼眼投影表
  errors.js    DistortionError
test/          node:test 测试（中心点、四角、桶形/枕形、越界点、
               极端系数、NaN、正逆往返、迭代失败路径）
```
