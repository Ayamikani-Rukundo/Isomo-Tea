type StickerPose =
  | 'hands-up'
  | 'shrug'
  | 'thumbs-up'
  | 'crossed-arms'
  | 'phone'
  | 'point'
  | 'thinking'
  | 'welcoming'
  | 'panic'
  | 'crying'
  | 'clap'
  | 'facepalm'
  | 'dance'
  | 'listening'
  | 'laughing'
  | 'dramatic'
  | 'calm'

type StickerFace = 'smile' | 'gasp' | 'side-eye' | 'wink' | 'calm' | 'laugh' | 'sob'
type StickerHair = 'afro' | 'locs' | 'wrap' | 'fade' | 'braids' | 'messy' | 'bob' | 'puffs'

type CharacterSticker = {
  phrase: string
  skin: string
  hair: string
  shirt: string
  background: string
  accent: string
  pose: StickerPose
  face: StickerFace
  hairStyle: StickerHair
}

const characterStickers: Record<string, CharacterSticker> = {
  yewe_sha: { phrase: 'Yewe sha!', skin: '#9a6248', hair: '#241a21', shirt: '#f05b78', background: '#ffe2bd', accent: '#a94e78', pose: 'shrug', face: 'side-eye', hairStyle: 'afro' },
  mbega: { phrase: 'Mbega!', skin: '#704332', hair: '#181827', shirt: '#9174e8', background: '#e8dfff', accent: '#7053c6', pose: 'hands-up', face: 'gasp', hairStyle: 'puffs' },
  nta_kibazo: { phrase: 'Nta kibazo', skin: '#e4a77b', hair: '#30202a', shirt: '#249b8d', background: '#d8f4e3', accent: '#1b766d', pose: 'calm', face: 'smile', hairStyle: 'locs' },
  yego_rwose: { phrase: 'Yego rwose', skin: '#81503c', hair: '#261b27', shirt: '#efab37', background: '#fff0bd', accent: '#c67b19', pose: 'thumbs-up', face: 'laugh', hairStyle: 'wrap' },
  oya_sha: { phrase: 'Oya sha!', skin: '#d08e6c', hair: '#28212a', shirt: '#d94959', background: '#ffe0e4', accent: '#a9253b', pose: 'crossed-arms', face: 'side-eye', hairStyle: 'fade' },
  amakuru: { phrase: 'Amakuru?', skin: '#654135', hair: '#241c22', shirt: '#4f8edb', background: '#d9edff', accent: '#2865ad', pose: 'phone', face: 'smile', hairStyle: 'locs' },
  ndumva: { phrase: 'Ndumva!', skin: '#edb589', hair: '#40252b', shirt: '#86a847', background: '#e8f4c8', accent: '#587829', pose: 'listening', face: 'wink', hairStyle: 'bob' },
  reka_da: { phrase: 'Reka da!', skin: '#8b533d', hair: '#21191d', shirt: '#ec7545', background: '#ffe1cc', accent: '#bd4c2b', pose: 'welcoming', face: 'gasp', hairStyle: 'afro' },
  ngwino: { phrase: 'Ngwino utubwire', skin: '#c98361', hair: '#29212a', shirt: '#3c9b83', background: '#d9f4e9', accent: '#26715e', pose: 'welcoming', face: 'smile', hairStyle: 'wrap' },
  yampayinka: { phrase: 'Yampayinka!', skin: '#70483a', hair: '#2a1e29', shirt: '#c65da3', background: '#f9dcf1', accent: '#9a397c', pose: 'dramatic', face: 'gasp', hairStyle: 'braids' },
  brooo_urabizi: { phrase: 'Brooo, urabizi?', skin: '#e7b384', hair: '#38232a', shirt: '#328cb0', background: '#d8f4ff', accent: '#24647f', pose: 'point', face: 'laugh', hairStyle: 'fade' },
  ahubwo_se: { phrase: 'Ahubwo se?', skin: '#89553f', hair: '#211b22', shirt: '#bc7a3b', background: '#ffebc9', accent: '#91581f', pose: 'thinking', face: 'side-eye', hairStyle: 'braids' },
  humura_sha: { phrase: 'Humura sha', skin: '#d89a73', hair: '#322128', shirt: '#6686c9', background: '#e3e9ff', accent: '#495e9c', pose: 'calm', face: 'calm', hairStyle: 'puffs' },
  birakaze: { phrase: 'Birakaze!', skin: '#e5aa7c', hair: '#3a2526', shirt: '#df5949', background: '#ffe1cf', accent: '#a83831', pose: 'panic', face: 'gasp', hairStyle: 'messy' },
  shaaa: { phrase: 'Shaaa!', skin: '#80503f', hair: '#261a24', shirt: '#ad71cf', background: '#f0dfff', accent: '#7945a3', pose: 'crying', face: 'sob', hairStyle: 'wrap' },
  dore_ibintu: { phrase: 'Dore ibintu!', skin: '#ba765b', hair: '#251a21', shirt: '#e28d3d', background: '#ffedca', accent: '#a55e23', pose: 'clap', face: 'laugh', hairStyle: 'locs' },
}

const poseArms: Record<StickerPose, { left: string; right: string; leftHand: string; rightHand: string }> = {
  'hands-up': { left: 'M66 102 Q51 91 40 62', right: 'M114 102 Q130 90 140 62', leftHand: 'M40 62 l-7 -10 M40 62 l1 -13', rightHand: 'M140 62 l7 -10 M140 62 l-1 -13' },
  shrug: { left: 'M66 103 Q49 91 35 82', right: 'M114 103 Q131 91 145 82', leftHand: 'M35 82 l-7 -5 M35 82 l-1 -8', rightHand: 'M145 82 l7 -5 M145 82 l1 -8' },
  'thumbs-up': { left: 'M66 104 Q52 116 49 132', right: 'M114 103 Q130 92 134 76', leftHand: 'M49 132', rightHand: 'M134 76 l-1 -18 M134 76 l8 -8' },
  'crossed-arms': { left: 'M66 104 Q79 116 103 120', right: 'M114 104 Q99 116 76 121', leftHand: 'M103 120', rightHand: 'M76 121' },
  phone: { left: 'M66 103 Q52 114 48 129', right: 'M114 103 Q127 95 131 82', leftHand: 'M48 129', rightHand: 'M131 82' },
  point: { left: 'M66 103 Q52 114 48 130', right: 'M114 103 Q133 93 147 76', leftHand: 'M48 130', rightHand: 'M147 76 l13 -5 M147 76 l9 8' },
  thinking: { left: 'M66 103 Q53 115 50 130', right: 'M114 103 Q100 95 94 83', leftHand: 'M50 130', rightHand: 'M94 83 l-7 -7 M94 83 l4 -9' },
  welcoming: { left: 'M66 103 Q48 94 34 71', right: 'M114 103 Q132 94 146 71', leftHand: 'M34 71 l-8 -7 M34 71 l1 -10', rightHand: 'M146 71 l8 -7 M146 71 l-1 -10' },
  panic: { left: 'M66 103 Q49 86 55 58', right: 'M114 103 Q131 86 125 58', leftHand: 'M55 58 l-8 -7 M55 58 l7 -9', rightHand: 'M125 58 l8 -7 M125 58 l-7 -9' },
  crying: { left: 'M66 103 Q52 89 65 76', right: 'M114 103 Q128 89 115 76', leftHand: 'M65 76', rightHand: 'M115 76' },
  clap: { left: 'M66 103 Q78 106 88 112', right: 'M114 103 Q102 106 92 112', leftHand: 'M88 112', rightHand: 'M92 112' },
  facepalm: { left: 'M66 103 Q52 114 49 130', right: 'M114 103 Q106 89 97 71', leftHand: 'M49 130', rightHand: 'M97 71 l-8 -8 M97 71 l1 -10' },
  dance: { left: 'M66 103 Q46 89 39 67', right: 'M114 103 Q137 91 141 72', leftHand: 'M39 67 l-8 -6 M39 67 l4 -10', rightHand: 'M141 72 l8 -8 M141 72 l-1 -10' },
  listening: { left: 'M66 103 Q52 114 49 130', right: 'M114 103 Q132 91 125 72', leftHand: 'M49 130', rightHand: 'M125 72 l-8 -4 M125 72 l7 -7' },
  laughing: { left: 'M66 103 Q48 92 39 79', right: 'M114 103 Q132 92 141 79', leftHand: 'M39 79', rightHand: 'M141 79' },
  dramatic: { left: 'M66 103 Q50 89 46 69', right: 'M114 103 Q130 89 134 69', leftHand: 'M46 69 l-8 -7 M46 69 l-1 -10', rightHand: 'M134 69 l8 -7 M134 69 l1 -10' },
  calm: { left: 'M66 103 Q54 115 52 132', right: 'M114 103 Q126 115 128 132', leftHand: 'M52 132', rightHand: 'M128 132' },
}

const hairShapes: Record<StickerHair, string> = {
  afro: 'M61 68 Q49 43 65 32 Q82 16 101 29 Q123 24 121 51 Q131 61 119 74 L113 57 Q97 48 83 55 Q72 62 63 77 Z',
  locs: 'M61 60 Q55 34 75 29 Q93 17 111 30 Q126 40 119 62 L124 91 L113 83 L109 56 Q94 48 80 54 Q69 60 64 84 Z',
  wrap: 'M59 60 Q55 38 68 33 L61 25 Q86 12 112 27 L124 24 L116 38 Q125 49 119 68 L111 54 Q88 43 67 57 Z',
  fade: 'M61 59 Q61 34 83 30 Q104 25 117 42 L120 58 Q103 48 88 51 Q74 52 62 63 Z',
  braids: 'M61 58 Q58 35 77 30 Q100 20 117 39 L120 62 L125 91 L117 89 L112 57 Q95 47 78 54 L69 90 L61 91 Z',
  messy: 'M60 59 L54 44 L67 45 L64 29 L81 36 L88 24 L98 35 L114 28 L112 43 L124 44 L119 64 Q97 49 79 55 L63 67 Z',
  bob: 'M61 59 Q58 32 83 28 Q109 24 119 48 L119 88 L108 84 L109 55 Q90 48 72 56 L70 88 L61 89 Z',
  puffs: 'M65 53 Q51 45 58 34 Q63 23 75 29 Q83 13 96 24 Q110 15 116 32 Q131 33 126 48 L117 60 Q97 48 79 55 Z',
}

export function StickerArtwork({ code, className }: { code: string; className: string }) {
  const art = characterStickers[code]
  if (!art) return null
  const arms = poseArms[art.pose]
  const face = art.face

  return (
    <svg className={className} viewBox="0 0 180 170" role="img" aria-label={art.phrase}>
      <path d="M92 7 C116 8 121 18 139 24 C157 31 170 46 166 66 C162 85 173 98 163 116 C153 135 137 132 122 143 C104 156 78 158 61 144 C44 130 23 135 16 116 C8 97 20 82 14 65 C7 46 20 31 39 25 C58 19 68 7 92 7Z" fill={art.background} />
      <path d="M28 42 l4 -10 4 10 10 4 -10 4 -4 10 -4 -10 -10 -4z M143 35 l3 -7 3 7 7 3 -7 3 -3 7 -3 -7 -7 -3z" fill={art.accent} opacity=".7" />
      <g fill="none" stroke={art.shirt} strokeLinecap="round" strokeLinejoin="round" strokeWidth="13">
        <path d={arms.left} />
        <path d={arms.right} />
      </g>
      <g fill="none" stroke={art.skin} strokeLinecap="round" strokeLinejoin="round" strokeWidth="7">
        <path d={arms.leftHand} />
        <path d={arms.rightHand} />
      </g>
      {art.pose === 'phone' && <g transform="rotate(-12 132 78)"><rect x="126" y="66" width="13" height="23" rx="3" fill="#22212b" /><rect x="128" y="69" width="9" height="16" rx="1" fill="#b9edff" /></g>}
      <path d="M77 88 h26 v15 H77z" fill={art.skin} />
      <path d="M62 99 Q89 83 116 99 L130 143 H48 Z" fill={art.shirt} stroke="#fff" strokeLinejoin="round" strokeWidth="4" />
      <circle cx="90" cy="63" r="32" fill={art.skin} stroke="#fff" strokeWidth="4" />
      <path d={hairShapes[art.hairStyle]} fill={art.hair} stroke="#fff" strokeLinejoin="round" strokeWidth="4" />
      {face === 'side-eye'
        ? <g fill="#251c22"><ellipse cx="79" cy="66" rx="3" ry="4" /><ellipse cx="100" cy="63" rx="3" ry="4" /></g>
        : face === 'wink'
        ? <g fill="none" stroke="#251c22" strokeLinecap="round" strokeWidth="3"><path d="M74 63 q5 -5 10 0" /><ellipse cx="101" cy="64" rx="2.7" ry="4" fill="#251c22" /></g>
        : face === 'calm'
        ? <g fill="none" stroke="#251c22" strokeLinecap="round" strokeWidth="3"><path d="M74 64 h9 M97 64 h9" /></g>
        : face === 'sob'
        ? <g fill="#251c22"><ellipse cx="79" cy="63" rx="3" ry="4" /><ellipse cx="101" cy="63" rx="3" ry="4" /></g>
        : <g fill="#251c22"><ellipse cx="79" cy="63" rx={face === 'gasp' ? 3.5 : 2.8} ry={face === 'gasp' ? 5 : 3.5} /><ellipse cx="101" cy="63" rx={face === 'gasp' ? 3.5 : 2.8} ry={face === 'gasp' ? 5 : 3.5} /></g>}
      {face === 'gasp'
        ? <ellipse cx="90" cy="78" rx="5" ry="7" fill="#6c2939" />
        : face === 'sob'
        ? <g fill="none" stroke="#533044" strokeLinecap="round" strokeWidth="3"><path d="M82 79 Q90 72 98 79" /><path d="M76 70 q-3 7 0 10 M104 70 q3 7 0 10" stroke="#6fc5e4" /></g>
        : face === 'calm'
        ? <path d="M84 78 Q90 82 96 78" fill="none" stroke="#533044" strokeLinecap="round" strokeWidth="3" />
        : face === 'laugh'
        ? <path d="M81 75 Q90 91 99 75 Q91 79 81 75Z" fill="#793447" />
        : <path d="M82 77 Q90 84 98 77" fill="none" stroke="#533044" strokeLinecap="round" strokeWidth="3" />}
      <rect x="8" y="143" width="164" height="22" rx="11" fill="#fff" stroke={art.accent} strokeWidth="2" />
      <text x="90" y="158" textAnchor="middle" fill="#322531" fontFamily="system-ui, sans-serif" fontSize="10" fontWeight="800" textLength="148" lengthAdjust="spacingAndGlyphs">{art.phrase}</text>
    </svg>
  )
}
