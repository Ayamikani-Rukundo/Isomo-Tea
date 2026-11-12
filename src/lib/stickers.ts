export const stickerOptions = [
  { code: 'tea', label: 'Tea time', emoji: '🍵' },
  { code: 'leaf', label: 'Little leaf', emoji: '🌱' },
  { code: 'sparkle', label: 'Sparkle', emoji: '✨' },
  { code: 'frog', label: 'Happy frog', emoji: '🐸' },
  { code: 'teapot', label: 'Teapot', emoji: '🫖' },
  { code: 'heart', label: 'Green heart', emoji: '💚' },
  { code: 'herb', label: 'Fresh herbs', emoji: '🌿' },
  { code: 'coffee', label: 'Coffee break', emoji: '☕' },
  { code: 'side_eye', label: 'Side eye', emoji: '🙄' },
  { code: 'spill', label: 'Spill it', emoji: '🫢' },
  { code: 'clown', label: 'The clownery', emoji: '🤡' },
  { code: 'awkward', label: 'Awkward', emoji: '🫠' },
  { code: 'receipts', label: 'Need receipts', emoji: '🧾' },
  { code: 'plot_twist', label: 'Plot twist', emoji: '🍿' },
  { code: 'caught', label: 'Caught in 4K', emoji: '👀' },
  { code: 'bruh', label: 'Bruh', emoji: '😑' },
  { code: 'say_less', label: 'Say less', emoji: '🤐' },
  { code: 'yapper', label: 'Certified yapper', emoji: '🗣️' },
  { code: 'dramatic', label: 'So dramatic', emoji: '🎭' },
  { code: 'sobbing', label: 'I am unwell', emoji: '😭' },
  { code: 'unbothered', label: 'Unbothered', emoji: '😎' },
  { code: 'bye', label: 'I am leaving', emoji: '🏃' },
  { code: 'sus', label: 'That is sus', emoji: '🫣' },
  { code: 'chaos', label: 'Choose chaos', emoji: '🌪️' },
  { code: 'snack', label: 'Here for snacks', emoji: '🍿' },
  { code: 'broke', label: 'Broke bestie', emoji: '💸' },
  { code: 'sleepy', label: 'Logging off', emoji: '😴' },
  { code: 'cringe', label: 'Secondhand cringe', emoji: '😬' },
  { code: 'oops', label: 'Oopsie', emoji: '🤭' },
  { code: 'slay', label: 'Respectfully, slay', emoji: '💅' },
  { code: 'cap', label: 'That is cap', emoji: '🧢' },
  { code: 'facts', label: 'Facts only', emoji: '🫡' },
  { code: 'yewe_sha', label: 'Yewe sha!', emoji: '😳' },
  { code: 'mbega', label: 'Mbega!', emoji: '😮' },
  { code: 'nta_kibazo', label: 'Nta kibazo', emoji: '👌' },
  { code: 'yego_rwose', label: 'Yego rwose', emoji: '🙌' },
  { code: 'oya_sha', label: 'Oya sha!', emoji: '🙅🏾' },
  { code: 'amakuru', label: 'Amakuru?', emoji: '📱' },
  { code: 'ndumva', label: 'Ndumva!', emoji: '👂🏾' },
  { code: 'reka_da', label: 'Reka da!', emoji: '🤲🏾' },
  { code: 'ngwino', label: 'Ngwino utubwire', emoji: '🫴🏾' },
  { code: 'yampayinka', label: 'Yampayinka!', emoji: '😱' },
  { code: 'brooo_urabizi', label: 'Brooo, urabizi?', emoji: '👉🏾' },
  { code: 'ahubwo_se', label: 'Ahubwo se?', emoji: '🤔' },
  { code: 'humura_sha', label: 'Humura sha', emoji: '🫶🏾' },
  { code: 'birakaze', label: 'Birakaze!', emoji: '🤯' },
  { code: 'shaaa', label: 'Shaaa!', emoji: '😭' },
  { code: 'dore_ibintu', label: 'Dore ibintu!', emoji: '👏🏾' },
] as const

const imageStickerCodes = new Set([
  'tea', 'leaf', 'sparkle', 'frog', 'teapot', 'heart', 'herb', 'coffee',
])

const illustratedStickerCodes = new Set([
  'yewe_sha', 'mbega', 'nta_kibazo', 'yego_rwose', 'oya_sha', 'amakuru',
  'ndumva', 'reka_da', 'ngwino', 'yampayinka', 'brooo_urabizi', 'ahubwo_se',
  'humura_sha', 'birakaze', 'shaaa', 'dore_ibintu',
])

export function getStickerOption(code: string) {
  return stickerOptions.find((sticker) => sticker.code === code)
}

export function isImageSticker(code: string) {
  return imageStickerCodes.has(code)
}

export function isIllustratedSticker(code: string) {
  return illustratedStickerCodes.has(code)
}
