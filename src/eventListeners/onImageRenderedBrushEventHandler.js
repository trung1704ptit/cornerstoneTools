import store from '../store/index.js';
import getActiveToolsForElement from '../store/getActiveToolsForElement.js';
import { getToolState } from '../stateManagement/toolState.js';
import external from '../externalModules.js';
import BaseBrushTool from './../tools/base/BaseBrushTool.js';
import {
  getNewContext,
  resetCanvasContextTransform,
  transformCanvasContext,
} from '../drawing/index.js';

import { getLogger } from '../util/logger.js';

const logger = getLogger('store:modules:brushModule');

const brushModule = store.modules.brush;

/* Safari and Edge polyfill for createImageBitmap
 * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/createImageBitmap
 */

// TODO: Do we still need this? I've yanked the package for now
// It should be covered by @babel/runtime and plugin-transform-runtime:
// https://babeljs.io/docs/en/babel-plugin-transform-runtime
// @James, I think Babel should take care of this for us
// Import regeneratorRuntime from "regenerator-runtime";

if (!('createImageBitmap' in window)) {
  window.createImageBitmap = function(imageData) {
    return new Promise(resolve => {
      const img = document.createElement('img');

      img.addEventListener('load', function() {
        resolve(this);
      });

      const conversionCanvas = document.createElement('canvas');

      conversionCanvas.width = imageData.width;
      conversionCanvas.height = imageData.height;

      const conversionCanvasContext = conversionCanvas.getContext('2d');

      conversionCanvasContext.putImageData(
        imageData,
        0,
        0,
        0,
        0,
        conversionCanvas.width,
        conversionCanvas.height
      );
      img.src = conversionCanvas.toDataURL();
    });
  };
}

const { state, getters, setters } = store.modules.brush;

/**
 * Used to redraw the brush label map data per render.
 *
 * @private
 * @param {Object} evt - The event.
 * @returns {void}
 */
export default function(evt) {
  const eventData = evt.detail;
  const element = eventData.element;

  const {
    activeLabelmapIndex,
    labelmaps3D,
    currentImageIdIndex,
  } = brushModule.getters.labelmaps3D(element);

  if (!labelmaps3D) {
    return;
  }

  for (let i = 0; i < labelmaps3D.length; i++) {
    const labelmap3D = labelmaps3D[i];

    if (!labelmap3D) {
      continue;
    }

    const labelmap2D = labelmap3D.labelmaps2D[currentImageIdIndex];

    if (labelmap2D) {
      const imageBitmapCache = labelmap3D.imageBitmapCache;

      const isActiveLabelMap = activeLabelmapIndex === i;

      renderSegmentation(
        evt,
        labelmap3D,
        i,
        labelmap2D,
        imageBitmapCache,
        isActiveLabelMap
      );
    }
  }
}

function renderSegmentation(
  evt,
  labelmap3D,
  labelmapIndex,
  labelmap2D,
  imageBitmapCache,
  isActiveLabelMap
) {
  // Draw previous image if cached.
  if (imageBitmapCache) {
    _drawImageBitmap(evt, imageBitmapCache, isActiveLabelMap);
  }

  if (labelmap2D.invalidated) {
    createNewBitmapAndQueueRenderOfSegmentation(
      evt,
      labelmap3D,
      labelmapIndex,
      labelmap2D
    );
  }
}

function createNewBitmapAndQueueRenderOfSegmentation(
  evt,
  labelmap3D,
  labelmapIndex,
  labelmap2D
) {
  const eventData = evt.detail;
  const element = eventData.element;
  const enabledElement = external.cornerstone.getEnabledElement(element);

  const pixelData = labelmap2D.pixelData;

  const imageData = new ImageData(
    eventData.image.width,
    eventData.image.height
  );
  const image = {
    stats: {},
    minPixelValue: 0,
    getPixelData: () => pixelData,
  };

  const colorMapId = `${brushModule.state.colorMapId}_${labelmapIndex}`;

  external.cornerstone.storedPixelDataToCanvasImageDataColorLUT(
    image,
    state.colorLutTables[colorMapId],
    imageData.data
  );

  window.createImageBitmap(imageData).then(newImageBitmap => {
    labelmap3D.imageBitmapCache = newImageBitmap;
    labelmap2D.invalidated = false;

    external.cornerstone.updateImage(eventData.element);
  });
}

/**
 * Draws the ImageBitmap the canvas.
 *
 * @private
 * @param  {Object} evt description
 * @param {ImageBitmap} imageBitmap
 * @param {boolean} isActiveLabelMap
 * @returns {void}
 */
function _drawImageBitmap(evt, imageBitmap, isActiveLabelMap) {
  const eventData = evt.detail;
  const context = getNewContext(eventData.canvasContext.canvas);

  const canvasTopLeft = external.cornerstone.pixelToCanvas(eventData.element, {
    x: 0,
    y: 0,
  });

  const canvasTopRight = external.cornerstone.pixelToCanvas(eventData.element, {
    x: eventData.image.width,
    y: 0,
  });

  const canvasBottomRight = external.cornerstone.pixelToCanvas(
    eventData.element,
    {
      x: eventData.image.width,
      y: eventData.image.height,
    }
  );

  const cornerstoneCanvasWidth = external.cornerstoneMath.point.distance(
    canvasTopLeft,
    canvasTopRight
  );
  const cornerstoneCanvasHeight = external.cornerstoneMath.point.distance(
    canvasTopRight,
    canvasBottomRight
  );

  const canvas = eventData.canvasContext.canvas;
  const viewport = eventData.viewport;

  context.imageSmoothingEnabled = false;
  context.globalAlpha = isActiveLabelMap
    ? state.alpha
    : state.alphaOfInactiveLabelmap;

  transformCanvasContext(context, canvas, viewport);

  const canvasViewportTranslation = {
    x: viewport.translation.x * viewport.scale,
    y: viewport.translation.y * viewport.scale,
  };

  context.drawImage(
    imageBitmap,
    canvas.width / 2 - cornerstoneCanvasWidth / 2 + canvasViewportTranslation.x,
    canvas.height / 2 -
      cornerstoneCanvasHeight / 2 +
      canvasViewportTranslation.y,
    cornerstoneCanvasWidth,
    cornerstoneCanvasHeight
  );

  context.globalAlpha = 1.0;

  resetCanvasContextTransform(context);
}
