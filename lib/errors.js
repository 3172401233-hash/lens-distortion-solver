'use strict';

/**
 * 所有畸变计算失败统一抛出该错误，调用方可通过 code 区分原因。
 * 库永远不会在不可逆/不收敛时静默返回原始坐标。
 */
class DistortionError extends Error {
  /**
   * @param {string} code NON_FINITE / INVALID_OPTION / OUT_OF_DOMAIN /
   *                      SINGULAR_JACOBIAN / MAX_ITERATIONS
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'DistortionError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

module.exports = { DistortionError };
