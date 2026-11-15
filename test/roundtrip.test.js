'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DistortionError,
  distort,
  undistort,
} = require('../lib');
const { newtonInverse } = require('../lib/solver');

// 确定性伪随机，保证测试可复现
function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1280;
const H = 720;

describe('正逆往返 fuzz', () => {
  it('Brown-Conrady 随机点往返误差低于 1e-9 归一化单位', () => {
    const random = mulberry32(20261115);
    const options = {
      model: 'brown-conrady',
      width: W,
      height: H,
      coefficients: { k1: -0.18, k2: 0.05, p1: 0.002, p2: -0.001, k3: 0.01 },
      tolerance: 1e-12,
    };
    for (let i = 0; i < 200; i++) {
      // 覆盖画面内外 [-0.2, 1.2]
      const u = random() * 1.4 - 0.2;
      const v = random() * 1.4 - 0.2;
      const distorted = distort(u, v, options);
      const back = undistort(distorted.u, distorted.v, options);
      assert.ok(
        Math.hypot(back.u - u, back.v - v) < 1e-9,
        `fuzz 点 (${u},${v}) 往返失败`
      );
    }
  });

  it('鱼眼各投影随机点往返误差低于 1e-9', () => {
    const random = mulberry32(424242);
    for (const projection of ['equidistant', 'stereographic', 'equisolid', 'orthographic']) {
      const options = {
        model: 'fisheye',
        width: W,
        height: H,
        projection,
        coefficients: { k1: 0.03, k2: -0.008, k3: 0.001, k4: 0 },
        tolerance: 1e-12,
      };
      for (let i = 0; i < 100; i++) {
        const u = random() * 0.9 + 0.05;
        const v = random() * 0.9 + 0.05;
        const distorted = distort(u, v, options);
        const back = undistort(distorted.u, distorted.v, options);
        assert.ok(
          Math.hypot(back.u - u, back.v - v) < 1e-9,
          `${projection} fuzz 点 (${u},${v}) 往返失败`
        );
      }
    }
  });

  it('自定义光心与焦距下往返依然闭合', () => {
    const options = {
      model: 'brown-conrady',
      width: W,
      height: H,
      focalLength: 900,
      principalPoint: { x: W * 0.48, y: H * 0.52 },
      coefficients: { k1: -0.22, k2: 0.07, p1: 0.001, p2: 0.001 },
    };
    for (const [u, v] of [[0.5, 0.5], [0.1, 0.2], [0.95, 0.9], [0, 1]]) {
      const distorted = distort(u, v, options);
      const back = undistort(distorted.u, distorted.v, options);
      assert.ok(Math.hypot(back.u - u, back.v - v) < 1e-10);
    }
  });
});

describe('牛顿求解器单元行为', () => {
  it('恒等映射一步内收敛', () => {
    const result = newtonInverse(
      { x: 0.4, y: -0.3 },
      (x, y) => ({ x, y }),
      () => ({ a: 1, b: 0, c: 0, d: 1 }),
      { tolerance: 1e-12, maxIterations: 10 },
      'identity'
    );
    assert.ok(result.converged);
    assert.equal(result.iterations, 0);
    assert.equal(result.x, 0.4);
  });

  it('零行列式雅可比抛出 SINGULAR_JACOBIAN 且带迭代上下文', () => {
    assert.throws(
      () => newtonInverse(
        { x: 1, y: 1 },
        () => ({ x: 0, y: 0 }),
        () => ({ a: 0, b: 0, c: 0, d: 0 }),
        { tolerance: 1e-12, maxIterations: 10 },
        'singular'
      ),
      (error) => {
        assert.ok(error instanceof DistortionError);
        assert.equal(error.code, 'SINGULAR_JACOBIAN');
        assert.equal(error.details.iteration, 1);
        assert.equal(error.details.determinant, 0);
        return true;
      }
    );
  });

  it('迭代耗尽时抛出 MAX_ITERATIONS 并保留残差与最后坐标', () => {
    assert.throws(
      () => newtonInverse(
        // 线性系统配错误雅可比：错误步长每次只前进 1/4，耗尽迭代
        { x: 0, y: 0 },
        (x) => ({ x: 4 * x - 4, y: 0 }),
        () => ({ a: 16, b: 0, c: 0, d: 1 }),
        { tolerance: 1e-12, maxIterations: 5 },
        'diverging'
      ),
      (error) => {
        assert.equal(error.code, 'MAX_ITERATIONS');
        assert.equal(error.details.iterations, 5);
        assert.ok(error.details.residual > 0);
        assert.ok(Number.isFinite(error.details.x));
        return true;
      }
    );
  });

  it('正向函数产生 NaN 步进时抛出 NON_FINITE 而非静默返回原坐标', () => {
    assert.throws(
      () => newtonInverse(
        { x: 1, y: 0 },
        () => ({ x: NaN, y: 0 }),
        () => ({ a: 1, b: 0, c: 0, d: 1 }),
        { tolerance: 1e-12, maxIterations: 5 },
        'nan-forward'
      ),
      { code: 'NON_FINITE' }
    );
  });
});
