const usernameCharacter = String.raw`(?:[A-Za-z0-9._#*]|\p{Emoji}(?:\uFE0F)?|\p{Emoji_Modifier}|\p{Regional_Indicator}|\p{Extended_Pictographic}|\u200D|\uFE0E|\uFE0F|\u20E3|[\u{E0020}-\u{E007F}])`
const usernameSegment = `${usernameCharacter}+`

const usernamePattern = new RegExp(
  `^(?=.{3,24}$)${usernameSegment}(?: ${usernameSegment})*$`,
  'u',
)

export const usernameMentionPattern = new RegExp(
  `(^|\\s)(@"${usernameSegment}(?: ${usernameSegment})*"|@${usernameSegment})`,
  'gu',
)

export const usernameMentionQueryPattern = new RegExp(
  `(?:^|\\s)@(?:"((?:${usernameCharacter}| )*)"?|(${usernameCharacter}*))$`,
  'u',
)

export const usernameMentionTokenPattern = new RegExp(
  `^@"(${usernameSegment}(?: ${usernameSegment})*)"|^@(${usernameSegment})$`,
  'u',
)

export function validateUsername(username: string) {
  const value = username.trim()
  if (!usernamePattern.test(value)) {
    throw new Error('Use 3–24 letters, numbers, periods, underscores, emoji, and single spaces for your username.')
  }
  return value
}
