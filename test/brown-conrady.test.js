'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DistortionError,
  distort,
  estimateInverseError,
  undistort,
} = require('../lib');

const W = 640;
const H = 480;
const baseOptions = (overrides = {}) => ({
  model: 'brown-conrady',
  width: W,
  height: H,
  coefficients: { k1: -0.28, k2: 0.09, p1: 0.001, p2: -0.002, k3: 0.04 },
  ...overrides,
});

describe('Brown-Conrady 正向投影', () => {
  it('光心（画面中心）正向投影保持不变', () => {
    const result = distort(0.5, 0.5, baseOptions());
    assert.ok(Math.abs(result.u - 0.5) < 1e-15);
    assert.ok(Math.abs(result.v - 0.5) < 1e-15);
  });

  it('零系数为恒等映射', () => {
    const result = distort(0.2, 0.8, baseOptions({ coefficients: {} }));
    assert.ok(Math.abs(result.u - 0.2) < 1e-15);
    assert.ok(Math.abs(result.v - 0.8) < 1e-15);
  });

  it('桶形畸变（k1<0）把四角向画面中心拉', () => {
    const result = distort(0, 0, baseOptions({ coefficients: { k1: -0.3 } }));
    assert.ok(result.u > 0, `期望 u>0，实际 ${result.u}`);
    assert.ok(result.v > 0, `期望 v>0，实际 ${result.v}`);
  });

  it('枕形畸变（k1>0）把四角推离画面中心', () => {
    const result = distort(0, 0, baseOptions({ coefficients: { k1: 0.3 } }));
    assert.ok(result.u < 0, `期望 u<0，实际 ${result.u}`);
    assert.ok(result.v < 0, `期望 v<0，实际 ${result.v}`);
  });

  it('切向畸变产生非对称偏移，且 p1 取反时偏移反向', () => {
    const positive = distort(0.7, 0.3, baseOptions({ coefficients: { p1: 0.05 } }));
    const negative = distort(0.7, 0.3, baseOptions({ coefficients: { p1: -0.05 } }));
    const shiftPositive = positive.u - 0.7;
    const shiftNegative = negative.u - 0.7;
    assert.ok(Math.abs(shiftPositive) > 1e-4);
    assert.ok(Math.sign(shiftPositive) === -Math.sign(shiftNegative));
  });

  it('支持数组形式系数（5 元素 OpenCV 顺序 k1,k2,p1,p2,k3）', () => {
    const objectForm = distort(0.15, 0.85, baseOptions());
    const arrayForm = distort(0.15, 0.85, baseOptions({
      coefficients: [-0.28, 0.09, 0.001, -0.002, 0.04],
    }));
    assert.equal(objectForm.u, arrayForm.u);
    assert.equal(objectForm.v, arrayForm.v);
  });

  it('4 元素数组按 k1,k2,p1,p2 解析，k3 缺省为 0', () => {
    const four = distort(0.15, 0.85, baseOptions({
      coefficients: [-0.28, 0.09, 0.001, -0.002],
    }));
    const explicit = distort(0.15, 0.85, baseOptions({
      coefficients: { k1: -0.28, k2: 0.09, p1: 0.001, p2: -0.002, k3: 0 },
    }));
    assert.equal(four.u, explicit.u);
  });

  it('允许边界外点参与正向投影而不报错', () => {
    const result = distort(1.25, -0.15, baseOptions());
    assert.ok(Number.isFinite(result.u));
    assert.ok(Number.isFinite(result.v));
  });
});

describe('Brown-Conrady 逆向迭代求解', () => {
  it('中心点逆解为自身且迭代次数为 0', () => {
    const result = undistort(0.5, 0.5, baseOptions());
    assert.equal(result.u, 0.5);
    assert.equal(result.v, 0.5);
    assert.equal(result.iterations, 0);
    assert.equal(result.converged, true);
  });

  it('四角可稳定逆解并在最大迭代次数内收敛', () => {
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const result = undistort(u, v, baseOptions());
      assert.ok(result.converged);
      assert.ok(result.iterations <= result.maxIterations);
      assert.ok(result.residual <= result.tolerance);
    }
  });

  it('正逆往返误差低于 1e-10 归一化单位', () => {
    const points = [
      [0.5, 0.5], [0, 0], [1, 1], [0.1, 0.9], [0.9, 0.1],
      [0.25, 0.75], [0.75, 0.25], [1.2, -0.1],
    ];
    for (const [u, v] of points) {
      const distorted = distort(u, v, baseOptions());
      const back = undistort(distorted.u, distorted.v, baseOptions());
      assert.ok(
        Math.hypot(back.u - u, back.v - v) < 1e-9,
        `点 (${u},${v}) 往返误差过大`
      );
    }
  });

  it('边界外点同样可逆解且往返闭合', () => {
    const options = baseOptions();
    const distorted = distort(1.3, -0.2, options);
    const back = undistort(distorted.u, distorted.v, options);
    assert.ok(Math.hypot(back.u - 1.3, back.v + 0.2) < 1e-10);
  });

  it('极端系数下仍可在放宽迭代次数后收敛', () => {
    const options = baseOptions({
      coefficients: { k1: 5, k2: 20, k3: 50 },
      maxIterations: 200,
      tolerance: 1e-12,
    });
    const distorted = distort(0.08, 0.92, options);
    const back = undistort(distorted.u, distorted.v, options);
    assert.ok(back.converged);
    assert.ok(Math.hypot(back.u - 0.08, back.v - 0.92) < 1e-8);
  });

  it('超过最大迭代次数时抛出 MAX_ITERATIONS 而非返回原坐标', () => {
    const options = baseOptions({ maxIterations: 1 });
    assert.throws(
      () => undistort(0.1, 0.1, options),
      (error) => {
        assert.ok(error instanceof DistortionError);
        assert.equal(error.code, 'MAX_ITERATIONS');
        assert.equal(error.details.iterations, 1);
        assert.ok(error.details.residual > error.details.tolerance);
        return true;
      }
    );
  });

  it('强折叠参数使目标点无预图像时抛出错误，绝不静默返回', () => {
    const options = baseOptions({
      coefficients: { k1: -2 },
      maxIterations: 50,
    });
    assert.throws(
      () => undistort(0.1, 0.5, options),
      (error) => {
        assert.ok(error instanceof DistortionError);
        assert.equal(error.code, 'MAX_ITERATIONS');
        assert.ok(Number.isFinite(error.details.x));
        assert.ok(error.details.residual > error.details.tolerance);
        return true;
      }
    );
  });

  it('自定义收敛阈值会改变收敛行为', () => {
    const distorted = distort(0.1, 0.1, baseOptions());
    const tight = undistort(distorted.u, distorted.v, baseOptions({ tolerance: 1e-13 }));
    const loose = undistort(distorted.u, distorted.v, baseOptions({ tolerance: 1e-6 }));
    assert.ok(tight.residual <= 1e-13);
    assert.ok(loose.residual <= 1e-6);
  });

  it('非法迭代参数立即拒绝', () => {
    assert.throws(
      () => undistort(0.5, 0.5, baseOptions({ maxIterations: 0 })),
      { code: 'INVALID_OPTION' }
    );
    assert.throws(
      () => undistort(0.5, 0.5, baseOptions({ maxIterations: 2.5 })),
      { code: 'INVALID_OPTION' }
    );
    assert.throws(
      () => undistort(0.5, 0.5, baseOptions({ tolerance: 0 })),
      { code: 'INVALID_OPTION' }
    );
  });
});

describe('反向误差估计', () => {
  it('返回镜头单位、归一化单位和像素三种残差', () => {
    const estimate = estimateInverseError(0.12, 0.88, baseOptions());
    assert.ok(estimate.converged);
    assert.ok(estimate.residualLens < 1e-12);
    assert.ok(estimate.residualNormalized < 1e-12);
    assert.ok(estimate.residualPixels < 1e-9);
    assert.ok(Number.isInteger(estimate.iterations));
    assert.ok(Math.abs(estimate.reprojected.u - 0.12) < 1e-12);
  });

  it('逆解失败时误差估计向上抛出同一错误', () => {
    assert.throws(
      () => estimateInverseError(0.1, 0.1, baseOptions({ maxIterations: 1 })),
      { code: 'MAX_ITERATIONS' }
    );
  });
});

describe('NaN 与非法输入', () => {
  it('NaN 坐标抛出 NON_FINITE', () => {
    assert.throws(() => distort(NaN, 0.5, baseOptions()), { code: 'NON_FINITE' });
    assert.throws(() => undistort(0.5, NaN, baseOptions()), { code: 'NON_FINITE' });
  });

  it('Infinity 坐标抛出 NON_FINITE', () => {
    assert.throws(
      () => distort(Infinity, 0.5, baseOptions()),
      { code: 'NON_FINITE' }
    );
  });

  it('NaN 畸变系数抛出 NON_FINITE', () => {
    assert.throws(
      () => distort(0.5, 0.5, baseOptions({ coefficients: { k1: NaN } })),
      { code: 'NON_FINITE' }
    );
    assert.throws(
      () => undistort(0.5, 0.5, baseOptions({ coefficients: [0.1, NaN] })),
      { code: 'NON_FINITE' }
    );
  });

  it('非法图像尺寸拒绝', () => {
    assert.throws(
      () => distort(0.5, 0.5, baseOptions({ width: 0 })),
      { code: 'INVALID_OPTION' }
    );
    assert.throws(
      () => distort(0.5, 0.5, baseOptions({ height: -1 })),
      { code: 'INVALID_OPTION' }
    );
  });
});
