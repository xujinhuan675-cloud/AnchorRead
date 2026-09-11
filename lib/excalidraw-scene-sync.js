function serializeSceneValue(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function sceneElementChanged(currentElement, nextElement, { ignoreVersion = false } = {}) {
  if (!currentElement || !nextElement) return true;
  const scalarKeys = [
    'id',
    'isDeleted',
    'opacity',
    'strokeColor',
    'strokeWidth',
    'x',
    'y',
    'width',
    'height',
    'angle',
    'elbowed',
  ];
  if (!ignoreVersion) scalarKeys.splice(1, 0, 'version');
  if (scalarKeys.some((key) => currentElement[key] !== nextElement[key])) return true;
  return [
    'points',
    'startBinding',
    'endBinding',
    'boundElements',
  ].some((key) => serializeSceneValue(currentElement[key]) !== serializeSceneValue(nextElement[key]));
}

export function sceneElementsChanged(currentElements, nextElements) {
  if (!Array.isArray(currentElements) || !Array.isArray(nextElements)
    || currentElements.length !== nextElements.length) return true;
  return nextElements.some((nextElement, index) => sceneElementChanged(currentElements[index], nextElement));
}

export function sceneElementsMatch(currentElements, nextElements) {
  if (!Array.isArray(currentElements) || !Array.isArray(nextElements)
    || currentElements.length !== nextElements.length) return false;
  const currentById = new Map(currentElements.map((element) => [element?.id, element]));
  return nextElements.every((nextElement) => (
    currentById.has(nextElement?.id)
    && !sceneElementChanged(currentById.get(nextElement.id), nextElement, { ignoreVersion: true })
  ));
}
