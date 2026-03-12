const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);

function isSubtitleFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return SUBTITLE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

export function isSiblingSubtitleCandidate(videoName: string, subtitleName: string): boolean {
  if (!isSubtitleFile(subtitleName)) {
    return false;
  }

  const videoStem = stem(videoName);
  const subtitleStem = stem(subtitleName);
  if (subtitleStem === videoStem) {
    return true;
  }

  if (!subtitleStem.startsWith(videoStem)) {
    return false;
  }

  const nextChar = subtitleStem[videoStem.length];
  return nextChar === '.' || nextChar === ' ' || nextChar === '_' || nextChar === '-';
}

