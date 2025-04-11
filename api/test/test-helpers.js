import { AssertionError } from 'node:assert'

/**
 * @param {Response} res
 * @param {number} status
 */
export const assertResponseStatus = async (res, status) => {
  if (res.status !== status) {
    throw new AssertionError({
      actual: res.status,
      expected: status,
      message: await res.text()
    })
  }
}
