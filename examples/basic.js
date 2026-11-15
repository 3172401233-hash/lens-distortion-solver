'use strict';

const {
  distort,
  undistort,
  estimateInverseError,
  DistortionError,
} = require('../lib');

const options = {
  model: 'brown-conrady',
  width: 1280,
  height: 720,
  coefficients: { k1: -0.28, k2: 0.09, p1: 0.001, p2: -0.002, k3: 0.04 },
  tolerance: 1e-10,
  maxIterations: 50,
};

const screenPoint = { u: 0.12, v: 0.88 };

const distorted = distort(screenPoint.u, screenPoint.v, options);
console.log('正向投影:', distorted);

const inverse = undistort(distorted.u, distorted.v, options);
console.log('逆向求解:', inverse);

const error = estimateInverseError(distorted.u, distorted.v, options);
console.log('反向误差:', error);

try {
  undistort(0.1, 0.5, {
    ...options,
    coefficients: { k1: -2 },
    maxIterations: 50,
  });
} catch (failure) {
  if (failure instanceof DistortionError) {
    console.log(`预期失败 [${failure.code}]: ${failure.message}`);
  }
}
