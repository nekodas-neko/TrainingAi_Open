export const healthHeroGradients = {
  sleep: {
    dark: 'linear-gradient(180deg, #060620 0%, #0d0b3a 30%, #1a0f4e 55%, #0f1533 80%, transparent 100%)',
    light:
      'linear-gradient(180deg, #e8eafb 0%, #dde1f7 30%, #d2d8f2 55%, #dde3f5 80%, transparent 100%)',
  },
  readiness: {
    dark: 'linear-gradient(180deg, #020a18 0%, #051830 25%, #083560 52%, #1a6090 75%, #e87030 90%, transparent 100%)',
    light:
      'linear-gradient(180deg, #e3f0ff 0%, #d3e8ff 25%, #bfdcff 52%, #ffdcb0 75%, #ffb877 90%, transparent 100%)',
  },
  activity: {
    dark: 'linear-gradient(180deg, #0d0a2e 0%, #1e1260 28%, #3d1a6e 52%, #7c2d00 76%, transparent 100%)',
    light:
      'linear-gradient(180deg, #ede8fb 0%, #e0d6f7 28%, #e6cef0 52%, #ffd8b8 76%, transparent 100%)',
  },
  'heart-rate': {
    dark: 'linear-gradient(180deg, #5c1010 0%, #3d0808 30%, #280505 60%, #1a0303 82%, transparent 100%)',
    light:
      'linear-gradient(180deg, #ffe1e1 0%, #ffcccc 30%, #ffb3b3 60%, #ff9e9e 82%, transparent 100%)',
  },
};

// app/globals.css --page-gradient-*: the page behind a detail screen's hero, which the hero fades into.
export const healthPageGradients = {
  sleep: {
    dark: 'linear-gradient(180deg, #060620 0%, #09082a 18%, #070818 42%, #050614 68%, #040512 100%)',
    light: 'linear-gradient(180deg, #e8eafb 0%, #eef0fc 18%, #f2f3fd 42%, #f6f7fe 68%, #fafaff 100%)',
  },
  readiness: {
    dark: 'linear-gradient(180deg, #020a18 0%, #040e1e 18%, #030b18 40%, #020810 65%, #010508 100%)',
    light: 'linear-gradient(180deg, #e3f0ff 0%, #eaf4ff 18%, #eff8ff 40%, #f5fbff 65%, #fafdff 100%)',
  },
  activity: {
    dark: 'linear-gradient(180deg, #0d0a2e 0%, #0e0a25 18%, #0a0720 40%, #080519 65%, #060413 100%)',
    light: 'linear-gradient(180deg, #ede8fb 0%, #f0ecfc 18%, #f4f0fc 40%, #f8f5fd 65%, #fbf9fe 100%)',
  },
  'heart-rate': {
    dark: 'linear-gradient(180deg, #3d0808 0%, #280505 16%, #1a0303 36%, #100202 62%, #0a0202 100%)',
    light: 'linear-gradient(180deg, #ffe1e1 0%, #ffe9e9 16%, #fff0f0 36%, #fff6f6 62%, #fffafa 100%)',
  },
};

export const healthArtColors: Record<string, string> = {
  lightChip: 'rgba(255,255,255,0.55)',
  darkChip: 'rgba(0,0,0,0.35)',
  e4defb: '#e4defb',
  c4b5fd: '#c4b5fd',
  ffd080: '#ffd080',
  f5a040: '#f5a040',
  e87030: '#e87030',
  fff8e0: '#fff8e0',
  ffd060: '#ffd060',
  cce4f5: '#cce4f5',
  '1e1260': '#1e1260',
  '0d0a2e': '#0d0a2e',
  f97316: '#f97316',
  ef4444: '#ef4444',
};
Object.assign(healthArtColors, {
  mountainLightTop: '#9089ba',
  mountainLightBottom: '#726a9c',
  mountainDarkTop: '#0a0820',
  mountainDarkBottom: '#060412',
});
