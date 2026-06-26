const MUSIC_TRACKS = {
  'romantic-piano': {
    label: 'Romantic Piano',
    src: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_946f77164d.mp3?filename=soft-piano-music-142050.mp3',
  },
  'acoustic-love': {
    label: 'Acoustic Love',
    src: 'https://cdn.pixabay.com/download/audio/2023/10/30/audio_8f3310e26d.mp3?filename=acoustic-guitar-161410.mp3',
  },
  'classical-strings': {
    label: 'Classical Strings',
    src: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749913d.mp3?filename=classical-music-11290.mp3',
  },
  'jazz-evening': {
    label: 'Jazz Evening',
    src: 'https://cdn.pixabay.com/download/audio/2023/07/06/audio_3f7c6e2f1a.mp3?filename=jazz-lounge-145132.mp3',
  },
  none: { label: 'No Music', src: null },
};

function getMusicSrc(trackKey) {
  return MUSIC_TRACKS[trackKey]?.src ?? MUSIC_TRACKS['romantic-piano'].src;
}

module.exports = { MUSIC_TRACKS, getMusicSrc };
