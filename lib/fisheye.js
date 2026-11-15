'use strict';

const { DistortionError } = require('./errors');

/**
 * 可配置 Kannala-Brandt 风格鱼眼模型：
 *   theta  = 由基底投影给出（等距/体视/等立体角/正交）
 *   thetaD = theta * (1 + k1 theta^2 + k2 theta^4 + k3 theta^6 + k4 theta^8)
 *   r_d    = projection.thetaFn(thetaD)
 *   (xd, yd) = r_d / r * (x, y)
 * 等距投影且 r=theta 时即 OpenCV fisheye 模型。
 */

function thetaDPoly(theta, c) {
  const t2 = theta * theta;
  return theta * (
    1 + c.k1 * t2 + c.k2 * t2 * t2 +
    c.k3 * t2 * t2 * t2 + c.k4 * t2 * t2 * t2 * t2
  );
}

// d(thetaD)/d(theta)
function dThetaD(theta, c) {
  const t2 = theta * theta;
  return 1 + 3 * c.k1 * t2 + 5 * c.k2 * t2 * t2 +
    7 * c.k3 * t2 * t2 * t2 + 9 * c.k4 * t2 * t2 * t2 * t2;
}

function distortLens(x, y, c, projection) {
  const r = Math.hypot(x, y);
  if (r === 0) {
    return { x: 0, y: 0 };
  }
  const theta = projection.invertTheta(r);
  const thetaD = thetaDPoly(theta, c);
  const rd = projection.thetaFn(thetaD);
  if (!Number.isFinite(rd)) {
    throw new DistortionError(
      'NON_FINITE',
      '鱼眼正向投影产生非有限值（thetaD 超出基底投影定义域）'
    );
  }
  const scale = rd / r;
  return { x: x * scale, y: y * scale };
}

// 解析雅可比，基于径向映射 g(r) = projection(thetaD(invertTheta(r)))
function jacobian(x, y, c, projection) {
  const r = Math.hypot(x, y);
  if (r === 0) {
    // 原点处径向映射退化为各向同性线性缩放：g'(0) = thetaFn'(0) * thetaD'(0)
    const s = thetaFnDerivative(0, projection) * dThetaD(0, c);
    return { a: s, b: 0, c: 0, d: s };
  }

  const theta = projection.invertTheta(r);
  const thetaD = thetaDPoly(theta, c);
  const rd = projection.thetaFn(thetaD);

  // d(theta)/dr
  let dThetaDr;
  switch (projection.name) {
    case 'equidistant':
      dThetaDr = 1;
      break;
    case 'stereographic':
      dThetaDr = 1 / (1 + (r / 2) * (r / 2));
      break;
    case 'equisolid':
      dThetaDr = 1 / Math.sqrt(Math.max(0, 1 - (r / 2) * (r / 2)));
      break;
    case 'orthographic':
      dThetaDr = 1 / Math.sqrt(Math.max(0, 1 - r * r));
      break;
    default:
      throw new DistortionError('INVALID_OPTION', `未知投影 ${projection.name}`);
  }

  const dRdThetaD = thetaFnDerivative(thetaD, projection);
  const dgDr = dRdThetaD * dThetaD(theta, c) * dThetaDr;
  if (!Number.isFinite(dgDr)) {
    throw new DistortionError(
      'SINGULAR_JACOBIAN',
      '鱼眼雅可比在该点非有限（基底投影定义域边界）'
    );
  }

  // 径向函数 g(r) 的雅可比：切向 g/r，径向 dg/dr
  const tangential = rd / r;
  const radialDeriv = dgDr;
  const cos2 = (x * x) / (r * r);
  const sin2 = (y * y) / (r * r);
  const cs = (x * y) / (r * r);

  return {
    a: tangential + (radialDeriv - tangential) * cos2,
    b: (radialDeriv - tangential) * cs,
    c: (radialDeriv - tangential) * cs,
    d: tangential + (radialDeriv - tangential) * sin2,
  };
}

function thetaFnDerivative(angle, projection) {
  switch (projection.name) {
    case 'equidistant':
      return 1;
    case 'stereographic':
      return 1 / Math.cos(angle / 2) ** 2;
    case 'equisolid':
      return Math.cos(angle / 2);
    case 'orthographic':
      return Math.cos(angle);
    default:
      throw new DistortionError('INVALID_OPTION', `未知投影 ${projection.name}`);
  }
}

module.exports = { distortLens, dThetaD, jacobian, thetaDPoly };
