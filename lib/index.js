'use strict';

const brown = require('./brown');
const fisheye = require('./fisheye');
const { DistortionError } = require('./errors');
const {
  FISHEYE_PROJECTIONS,
  fromLens,
  parseBrownOptions,
  parseFisheyeOptions,
  requireFinite,
  toLens,
} = require('./geometry');
const { newtonInverse } = require('./solver');

/**
 * 正向投影：未畸变归一化像素坐标 -> 畸变后归一化像素坐标
 * @param {number} u 未畸变 x，范围 [0,1]（允许越界，越界不报错）
 * @param {number} v 未畸变 y，范围 [0,1]
 * @param {object} options { model, width, height, coefficients, projection?,
 *                           principalPoint?, focalLength? }
 */
function distort(u, v, options) {
  requireFinite(u, 'u');
  requireFinite(v, 'v');

  if (options.model === 'brown-conrady') {
    const opts = parseBrownOptions(options);
    const p = toLens(u, v, opts);
    const d = brown.distortLens(p.x, p.y, opts.coeffs);
    return { ...fromLens(d.x, d.y, opts), lens: d };
  }

  if (options.model === 'fisheye') {
    const opts = parseFisheyeOptions(options);
    const p = toLens(u, v, opts);
    ensureFisheyeDomain(p.x, p.y, opts.projection);
    const d = fisheye.distortLens(p.x, p.y, opts.coeffs, opts.projection);
    return { ...fromLens(d.x, d.y, opts), lens: d };
  }

  throw new DistortionError(
    'INVALID_OPTION',
    `未知模型 ${String(options.model)}，支持 brown-conrady / fisheye`
  );
}

/**
 * 逆向求解：畸变后归一化像素坐标 -> 未畸变坐标。
 * 不收敛或不可逆时抛出 DistortionError，绝不静默返回原坐标。
 * @returns {{u:number,v:number,iterations:number,residual:number,
 *            converged:boolean,lens:{x:number,y:number},
 *            tolerance:number,maxIterations:number}}
 */
function undistort(u, v, options) {
  requireFinite(u, 'u');
  requireFinite(v, 'v');

  if (options.model === 'brown-conrady') {
    const opts = parseBrownOptions(options);
    const target = toLens(u, v, opts);
    const result = target.x === 0 && target.y === 0
      ? { x: 0, y: 0, iterations: 0, residual: 0, converged: true }
      : newtonInverse(
          target,
          (x, y) => brown.distortLens(x, y, opts.coeffs),
          (x, y) => brown.jacobian(x, y, opts.coeffs),
          opts,
          'Brown-Conrady'
        );
    return buildUndistortResult(result, opts);
  }

  if (options.model === 'fisheye') {
    const opts = parseFisheyeOptions(options);
    const target = toLens(u, v, opts);
    const result = target.x === 0 && target.y === 0
      ? { x: 0, y: 0, iterations: 0, residual: 0, converged: true }
      : newtonInverse(
          target,
          (x, y) => {
            ensureFisheyeDomain(x, y, opts.projection);
            return fisheye.distortLens(x, y, opts.coeffs, opts.projection);
          },
          (x, y) => fisheye.jacobian(x, y, opts.coeffs, opts.projection),
          opts,
          `fisheye(${opts.projection.name})`
        );
    return buildUndistortResult(result, opts);
  }

  throw new DistortionError(
    'INVALID_OPTION',
    `未知模型 ${String(options.model)}，支持 brown-conrady / fisheye`
  );
}

function buildUndistortResult(result, opts) {
  const pixel = fromLens(result.x, result.y, opts);
  return {
    ...pixel,
    iterations: result.iterations,
    residual: result.residual,
    converged: result.converged,
    lens: { x: result.x, y: result.y },
    tolerance: opts.tolerance,
    maxIterations: opts.maxIterations,
  };
}

/**
 * 反向误差估计：对逆解结果再次正向投影，计算与输入点的残差。
 * 残差同时以归一化坐标和像素两种单位给出。
 */
function estimateInverseError(u, v, options) {
  const inverse = undistort(u, v, options);
  const reprojected = distort(inverse.u, inverse.v, options);
  const target = toLens(u, v, parseCommonForError(options));
  const deltaLens = {
    dx: reprojected.lens.x - target.x,
    dy: reprojected.lens.y - target.y,
  };
  const f = Number.isFinite(options.focalLength) ? options.focalLength : options.width;
  const pixelX = deltaLens.dx * f;
  const pixelY = deltaLens.dy * f;
  return {
    residualLens: Math.hypot(deltaLens.dx, deltaLens.dy),
    residualNormalized: Math.hypot(
      reprojected.u - u,
      reprojected.v - v
    ),
    residualPixels: Math.hypot(pixelX, pixelY),
    iterations: inverse.iterations,
    converged: inverse.converged,
    reprojected: { u: reprojected.u, v: reprojected.v },
  };
}

function parseCommonForError(options) {
  return options.model === 'fisheye'
    ? parseFisheyeOptions(options)
    : parseBrownOptions(options);
}

function ensureFisheyeDomain(x, y, projection) {
  const r = Math.hypot(x, y);
  if (r > projection.maxR) {
    throw new DistortionError(
      'OUT_OF_DOMAIN',
      `鱼眼基底投影 ${projection.name} 的定义域 r <= ${projection.maxR}，` +
        `当前 r = ${r}`,
      { r, maxR: projection.maxR, projection: projection.name }
    );
  }
}

module.exports = {
  DistortionError,
  FISHEYE_PROJECTIONS: Object.keys(FISHEYE_PROJECTIONS),
  distort,
  estimateInverseError,
  undistort,
};
