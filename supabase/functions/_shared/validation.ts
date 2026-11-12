export function validateUsername(value: unknown) {
  if (typeof value !== 'string') throw new Error('Enter a username.')
  const username = value.trim()
  if (!/^(?=.{3,24}$)[A-Za-z0-9._]+(?: [A-Za-z0-9._]+)*$/.test(username)) {
    throw new Error('Use 3–24 letters, numbers, periods, underscores, and single spaces for your username.')
  }
  return username
}

export function validatePassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new Error('Password must be between 8 and 128 characters.')
  }
  return value
}

export function validateAccessCode(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new Error('Enter the Isomo access code.')
  }
  return value
}

export function validateEmail(value: unknown) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Enter a valid administrator email address.')
  }
  return value.trim().toLowerCase()
}
