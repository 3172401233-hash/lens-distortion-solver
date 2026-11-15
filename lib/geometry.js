'use strict';

const { DistortionError } = require('./errors');

const BROWN_KEYS = ['k1', 'k2', 'p1', 'p2', 'k3'];
const FISHEYE_KEYS = ['k1', 'k2', 'k3', 'k4'];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireFinite(value, label) {
  if (!isFiniteNumber(value)) {
    throw new DistortionError(
      'NON_FINITE',
      `${label} 必须是有限数值，收到 ${String(value)}`
    );
  }
}

/**
 * 解析通用选项：图像尺寸、光心、焦距、迭代参数。
 * 坐标约定见 README：输入为归一化像素坐标，原点在图像左上角，单位 1 像素。
 */
function parseCommonOptions(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new DistortionError('INVALID_OPTION', 'options 必须是对象');
  }

  if (!isFiniteNumber(options.width) || !isFiniteNumber(options.height) ||
      options.width <= 0 || options.height <= 0) {
    throw new DistortionError(
      'INVALID_OPTION',
      'width 与 height 必须为正的有限数值'
    );
  }

  const principalPoint = options.principalPoint || {};
  const cx = isFiniteNumber(principalPoint.x)
    ? principalPoint.x : options.width / 2;
  const cy = isFiniteNumber(principalPoint.y)
    ? principalPoint.y : options.height / 2;

  const focalLength = isFiniteNumber(options.focalLength)
    ? options.focalLength : options.width;
  if (focalLength <= 0) {
    throw new DistortionError('INVALID_OPTION', 'focalLength 必须为正数');
  }

  const tolerance = isFiniteNumber(options.tolerance) ? options.tolerance : 1e-10;
  if (tolerance <= 0) {
    throw new DistortionError('INVALID_OPTION', 'tolerance 必须为正数');
  }

  const maxIterations = isFiniteNumber(options.maxIterations)
    ? options.maxIterations : 50;
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new DistortionError(
      'INVALID_OPTION',
      'maxIterations 必须为正整数'
    );
  }

  return { width: options.width, height: options.height, cx, cy, f: focalLength, tolerance, maxIterations };
}

function normalizeCoeffs(input, keys, arrayOrder, modelName) {
  let source = input;
  if (Array.isArray(input)) {
    source = {};
    input.forEach((value, index) => {
      if (index < arrayOrder.length) {
        source[arrayOrder[index]] = value;
      }
    });
  }
  if (source === null || typeof source !== 'object') {
    throw new DistortionError(
      'INVALID_OPTION',
      `${modelName} 畸变系数必须是数组或对象`
    );
  }

  const result = {};
  for (const key of keys) {
    const value = source[key];
    if (value === undefined) {
      result[key] = 0;
    } else if (!isFiniteNumber(value)) {
      throw new DistortionError(
        'NON_FINITE',
        `${modelName} 系数 ${key} 必须是有限数值，收到 ${String(value)}`
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function parseBrownOptions(options) {
  const common = parseCommonOptions(options);
  const coeffs = normalizeCoeffs(
    options.coefficients,
    BROWN_KEYS,
    ['k1', 'k2', 'p1', 'p2', 'k3'],
    'Brown-Conrady'
  );
  return { ...common, coeffs };
}

const FISHEYE_PROJECTIONS = {
  // 等距投影（OpenCV fisheye 采用的基底模型），theta_d = theta * (1 + ...)
  equidistant: {
    name: 'equidistant',
    thetaFn: (theta) => theta,
    // theta = r
    invertTheta: (r) => r,
    maxR: Infinity,
  },
  // 体视投影：r = 2 tan(theta/2)，theta = 2 atan(r/2)
  stereographic: {
    name: 'stereographic',
    thetaFn: (theta) => 2 * Math.tan(theta / 2),
    invertTheta: (r) => 2 * Math.atan(r / 2),
    maxR: Infinity,
  },
  // 等立体角投影：r = 2 sin(theta/2)，定义域 theta < pi，r < 2
  equisolid: {
    name: 'equisolid',
    thetaFn: (theta) => 2 * Math.sin(theta / 2),
    invertTheta: (r) => 2 * Math.asin(r / 2),
    maxR: 2 - 1e-12,
  },
  // 正交投影：r = sin(theta)，定义域 theta < pi/2，r < 1
  orthographic: {
    name: 'orthographic',
    thetaFn: (theta) => Math.sin(theta),
    invertTheta: (r) => Math.asin(r),
    maxR: 1 - 1e-12,
  },
};

function parseFisheyeOptions(options) {
  const common = parseCommonOptions(options);
  const projectionName = options.projection || 'equidistant';
  const projection = FISHEYE_PROJECTIONS[projectionName];
  if (!projection) {
    throw new DistortionError(
      'INVALID_OPTION',
      `未知鱼眼基底投影 ${String(projectionName)}，` +
      `支持 ${Object.keys(FISHEYE_PROJECTIONS).join(', ')}`
    );
  }
  const coeffs = normalizeCoeffs(
    options.coefficients,
    FISHEYE_KEYS,
    FISHEYE_KEYS,
    'fisheye'
  );
  return { ...common, coeffs, projection };
}

// 归一化像素坐标 -> 镜头归一化坐标（光心为原点，焦距为 1）
function toLens(u, v, opts) {
  requireFinite(u, 'u');
  requireFinite(v, 'v');
  return {
    x: (u * opts.width - opts.cx) / opts.f,
    y: (v * opts.height - opts.cy) / opts.f,
  };
}

// 镜头归一化坐标 -> 归一化像素坐标
function fromLens(x, y, opts) {
  return {
    u: (x * opts.f + opts.cx) / opts.width,
    v: (y * opts.f + opts.cy) / opts.height,
  };
}

function lensToPixelNorm(deltaLens, opts) {
  return {
    du: deltaLens.dx * opts.f / opts.width,
    dv: deltaLens.dy * opts.f / opts.height,
  };
}

module.exports = {
  FISHEYE_PROJECTIONS,
  fromLens,
  isFiniteNumber,
  lensToPixelNorm,
  parseBrownOptions,
  parseFisheyeOptions,
  requireFinite,
  toLens,
};
