'use strict';

const { DistortionError } = require('./errors');

/**
 * Brown-Conrady（OpenCV plumb-bob）模型，镜头归一化坐标下：
 *   x_d = x(1 + k1 r^2 + k2 r^4 + k3 r^6)
 *       + 2 p1 x y + p2 (r^2 + 2 x^2)
 *   y_d = y(1 + k1 r^2 + k2 r^4 + k3 r^6)
 *       + p1 (r^2 + 2 y^2) + 2 p2 x y
 */

function radialFactor(r2, c) {
  return 1 + c.k1 * r2 + c.k2 * r2 * r2 + c.k3 * r2 * r2 * r2;
}

// 返回 { x, y } 畸变后的镜头坐标
function distortLens(x, y, c) {
  const r2 = x * x + y * y;
  const radial = radialFactor(r2, c);
  const xy = x * y;
  const xd = x * radial + 2 * c.p1 * xy + c.p2 * (r2 + 2 * x * x);
  const yd = y * radial + c.p1 * (r2 + 2 * y * y) + 2 * c.p2 * xy;
  if (!Number.isFinite(xd) || !Number.isFinite(yd)) {
    throw new DistortionError(
      'NON_FINITE',
      'Brown-Conrady 正向投影产生非有限值（系数过强或坐标过大）'
    );
  }
  return { x: xd, y: yd };
}

// 解析雅可比 J = d(xd, yd)/d(x, y)
function jacobian(x, y, c) {
  const r2 = x * x + y * y;
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const radial = radialFactor(r2, c);
  // d(radial)/dr2
  const dr = c.k1 + 2 * c.k2 * r2 + 3 * c.k3 * r4;

  const dxdx = radial + 2 * dr * x * x
    + 2 * c.p1 * y + 6 * c.p2 * x;
  const dxdy = 2 * dr * x * y
    + 2 * c.p1 * x + 2 * c.p2 * y;
  const dydx = 2 * dr * x * y
    + 2 * c.p1 * x + 2 * c.p2 * y;
  const dydy = radial + 2 * dr * y * y
    + 6 * c.p1 * y + 2 * c.p2 * x;

  return { a: dxdx, b: dxdy, c: dydx, d: dydy };
}

module.exports = { distortLens, jacobian };
