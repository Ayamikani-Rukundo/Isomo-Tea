export function validateUsername(value: unknown) {
  if (typeof value !== 'string') throw new Error('Enter a username.')
  const username = value.trim()
  const usernameCharacter = String.raw`(?:[A-Za-z0-9._#*]|\p{Emoji}(?:\uFE0F)?|\p{Emoji_Modifier}|\p{Regional_Indicator}|\p{Extended_Pictographic}|\u200D|\uFE0E|\uFE0F|\u20E3|[\u{E0020}-\u{E007F}])`
  const usernameSegment = `${usernameCharacter}+`
  const usernamePattern = new RegExp(
    `^(?=.{3,24}$)${usernameSegment}(?: ${usernameSegment})*$`,
    'u',
  )
  if (!usernamePattern.test(username)) {
    throw new Error('Use 3–24 letters, numbers, periods, underscores, emoji, and single spaces for your username.')
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
