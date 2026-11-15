'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DistortionError,
  FISHEYE_PROJECTIONS,
  distort,
  estimateInverseError,
  undistort,
} = require('../lib');

const W = 640;
const H = 480;
const fisheyeOptions = (overrides = {}) => ({
  model: 'fisheye',
  width: W,
  height: H,
  projection: 'equidistant',
  coefficients: { k1: 0.04, k2: -0.012, k3: 0.003, k4: -0.0005 },
  ...overrides,
});

describe('鱼眼模型配置', () => {
  it('导出四种可配置基底投影', () => {
    assert.deepEqual(
      [...FISHEYE_PROJECTIONS].sort(),
      ['equidistant', 'equisolid', 'orthographic', 'stereographic'].sort()
    );
  });

 it('未知投影名抛出 INVALID_OPTION', () => {
    assert.throws(
      () => distort(0.5, 0.5, fisheyeOptions({ projection: 'mercator' })),
      { code: 'INVALID_OPTION' }
    );
  });

  it('支持 1-4 元素数组系数，缺省项补 0', () => {
    const arrayForm = distort(0.2, 0.7, fisheyeOptions({ coefficients: [0.04] }));
    const objectForm = distort(0.2, 0.7, fisheyeOptions({
      coefficients: { k1: 0.04, k2: 0, k3: 0, k4: 0 },
    }));
    assert.equal(arrayForm.u, objectForm.u);
  });
});

describe('鱼眼正向投影', () => {
  it('中心点恒为画面中心', () => {
    for (const projection of FISHEYE_PROJECTIONS) {
      const result = distort(0.5, 0.5, fisheyeOptions({ projection }));
      assert.ok(Math.abs(result.u - 0.5) < 1e-15);
      assert.ok(Math.abs(result.v - 0.5) < 1e-15);
    }
  });

  it('零系数下各基底投影保持自身映射规则且四角闭合', () => {
    for (const projection of FISHEYE_PROJECTIONS) {
      const options = fisheyeOptions({ projection, coefficients: {} });
      const result = distort(0.1, 0.9, options);
      assert.ok(Number.isFinite(result.u));
      const back = undistort(result.u, result.v, options);
      assert.ok(Math.hypot(back.u - 0.1, back.v - 0.9) < 1e-10);
    }
  });

  it('等距投影零系数为恒等映射（r=theta）', () => {
    const result = distort(0.25, 0.75, fisheyeOptions({ coefficients: {} }));
    assert.ok(Math.abs(result.u - 0.25) < 1e-15);
    assert.ok(Math.abs(result.v - 0.75) < 1e-15);
  });

  it('正系数扩张 thetaD，使外圈点进一步远离中心', () => {
    const compressed = distort(0, 0, fisheyeOptions({
      coefficients: { k1: 0.1 },
    }));
    assert.ok(compressed.u < 0, `期望 u<0，实际 ${compressed.u}`);
    assert.ok(compressed.v < 0, `期望 v<0，实际 ${compressed.v}`);
  });

  it('负系数收缩 thetaD，使外圈点向中心靠拢', () => {
    const expanded = distort(0, 0, fisheyeOptions({
      coefficients: { k1: -0.1 },
    }));
    assert.ok(expanded.u > 0, `期望 u>0，实际 ${expanded.u}`);
    assert.ok(expanded.v > 0, `期望 v>0，实际 ${expanded.v}`);
  });

  it('正交与等立体角投影对定义域外点抛出 OUT_OF_DOMAIN', () => {
    assert.throws(
      () => distort(0, 0.5, fisheyeOptions({
        projection: 'orthographic',
        focalLength: 100,
        coefficients: {},
      })),
      (error) => {
        assert.ok(error instanceof DistortionError);
        assert.equal(error.code, 'OUT_OF_DOMAIN');
        assert.ok(error.details.r > error.details.maxR);
        return true;
      }
    );
    assert.throws(
      () => distort(0, 0.5, fisheyeOptions({
        projection: 'equisolid',
        focalLength: 80,
        coefficients: {},
      })),
      { code: 'OUT_OF_DOMAIN' }
    );
  });

  it('体视与等距投影没有有限定义域上限', () => {
    for (const projection of ['equidistant', 'stereographic']) {
      const result = distort(1.4, -0.3, fisheyeOptions({
        projection,
        coefficients: {},
      }));
      assert.ok(Number.isFinite(result.u));
    }
  });
});

describe('鱼眼逆向迭代求解', () => {
  it('中心点逆解为自身且不消耗迭代', () => {
    const result = undistort(0.5, 0.5, fisheyeOptions());
    assert.equal(result.u, 0.5);
    assert.equal(result.iterations, 0);
    assert.equal(result.converged, true);
  });

  it('四种投影在四角均可逆解收敛', () => {
    for (const projection of FISHEYE_PROJECTIONS) {
      const options = fisheyeOptions({ projection });
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const distorted = distort(u, v, options);
        const back = undistort(distorted.u, distorted.v, options);
        assert.ok(back.converged, `${projection} (${u},${v}) 未收敛`);
        assert.ok(
          Math.hypot(back.u - u, back.v - v) < 1e-9,
          `${projection} (${u},${v}) 往返误差过大`
        );
      }
    }
  });

  it('正逆往返在画面网格上全部闭合', () => {
    const options = fisheyeOptions();
    for (let i = 1; i <= 4; i++) {
      for (let j = 1; j <= 4; j++) {
        const u = i / 5;
        const v = j / 5;
        const distorted = distort(u, v, options);
        const back = undistort(distorted.u, distorted.v, options);
        assert.ok(Math.hypot(back.u - u, back.v - v) < 1e-9);
      }
    }
  });

  it('逆解落在基底投影定义域外时抛出 OUT_OF_DOMAIN', () => {
    assert.throws(
      () => undistort(0, 0.5, fisheyeOptions({
        projection: 'orthographic',
        focalLength: 150,
        coefficients: { k1: -0.9 },
      })),
      { code: 'OUT_OF_DOMAIN' }
    );
  });

  it('极端系数导致不收敛时抛出 MAX_ITERATIONS', () => {
    const options = fisheyeOptions({
      coefficients: { k1: -1.5 },
      maxIterations: 30,
    });
    assert.throws(
      () => undistort(0.05, 0.95, { ...options, maxIterations: 20 }),
      (error) => {
        assert.ok(error instanceof DistortionError);
        assert.equal(error.code, 'MAX_ITERATIONS');
        assert.equal(error.details.iterations, 20);
        assert.ok(error.details.residual > 0);
        return true;
      }
    );
  });

  it('容差与最大迭代次数均可配置并体现在结果中', () => {
    const distorted = distort(0.2, 0.8, fisheyeOptions());
    const result = undistort(distorted.u, distorted.v, fisheyeOptions({
      tolerance: 1e-12,
      maxIterations: 5,
    }));
    assert.equal(result.tolerance, 1e-12);
    assert.equal(result.maxIterations, 5);
    assert.ok(result.residual <= 1e-12);
  });

  it('NaN 输入与 NaN 系数抛出 NON_FINITE', () => {
    assert.throws(
      () => undistort(NaN, 0.5, fisheyeOptions()),
      { code: 'NON_FINITE' }
    );
    assert.throws(
      () => distort(0.5, 0.5, fisheyeOptions({ coefficients: { k2: NaN } })),
      { code: 'NON_FINITE' }
    );
  });
});

describe('鱼眼反向误差估计', () => {
  it('三种单位残差均接近机器精度', () => {
    const estimate = estimateInverseError(0.18, 0.82, fisheyeOptions());
    assert.ok(estimate.converged);
    assert.ok(estimate.residualLens < 1e-12);
    assert.ok(estimate.residualNormalized < 1e-12);
    assert.ok(estimate.residualPixels < 1e-9);
  });

  it('像素残差与归一化残差满足图像宽度换算', () => {
    const estimate = estimateInverseError(0.3, 0.6, fisheyeOptions());
    assert.ok(
      Math.abs(estimate.residualPixels - estimate.residualNormalized * W)
        < 1e-9 * W
    );
  });
});
