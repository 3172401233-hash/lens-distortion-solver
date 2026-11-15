'use strict';

const { DistortionError } = require('./errors');

const SINGULAR_DETERMINANT = 1e-14;

/**
 * 牛顿-拉夫逊逆向求解：给定畸变后镜头坐标 target，求满足
 * forward(x) = target 的未畸变坐标。
 *
 * @param {object} target  { x, y } 畸变后镜头坐标
 * @param {function} forwardFn (x, y) => { x, y }
 * @param {function} jacobianFn (x, y) => 2x2 雅可比 { a, b, c, d }
 * @param {object} opts { tolerance, maxIterations }，容差单位为镜头坐标
 * @param {string} modelName 错误信息中的模型名
 * @returns {{x:number,y:number,iterations:number,residual:number,converged:boolean}}
 */
function newtonInverse(target, forwardFn, jacobianFn, opts, modelName) {
  let x = target.x;
  let y = target.y;

  for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
    const projected = forwardFn(x, y);
    const fx = projected.x - target.x;
    const fy = projected.y - target.y;
    const residual = Math.hypot(fx, fy);

    if (residual <= opts.tolerance) {
      return { x, y, iterations: iteration - 1, residual, converged: true };
    }

    const j = jacobianFn(x, y);
    const det = j.a * j.d - j.b * j.c;
    if (!Number.isFinite(det) || Math.abs(det) < SINGULAR_DETERMINANT) {
      throw new DistortionError(
        'SINGULAR_JACOBIAN',
        `${modelName} 逆解在第 ${iteration} 次迭代遇到奇异雅可比，` +
          '当前畸变参数在该区域不可逆',
        { iteration, x, y, target, determinant: det }
      );
    }

    const stepX = (j.d * fx - j.b * fy) / det;
    const stepY = (j.a * fy - j.c * fx) / det;
    if (!Number.isFinite(stepX) || !Number.isFinite(stepY)) {
      throw new DistortionError(
        'NON_FINITE',
        `${modelName} 逆解在第 ${iteration} 次迭代产生非有限步长`,
        { iteration, x, y, target }
      );
    }

    x -= stepX;
    y -= stepY;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new DistortionError(
        'NON_FINITE',
        `${modelName} 逆解在第 ${iteration} 次迭代后坐标非有限`,
        { iteration, target }
      );
    }
  }

  const finalProjected = forwardFn(x, y);
  const finalResidual = Math.hypot(
    finalProjected.x - target.x,
    finalProjected.y - target.y
  );
  throw new DistortionError(
    'MAX_ITERATIONS',
    `${modelName} 逆解在 ${opts.maxIterations} 次迭代后仍未收敛，` +
      `残差 ${finalResidual.toExponential(3)} 大于容差 ${opts.tolerance}`,
    {
      iterations: opts.maxIterations,
      residual: finalResidual,
      tolerance: opts.tolerance,
      x,
      y,
      target,
    }
  );
}

module.exports = { newtonInverse };
