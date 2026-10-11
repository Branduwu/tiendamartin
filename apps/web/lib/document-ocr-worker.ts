/** Dedicated session worker owns Tesseract's child worker, including initialization.
 * Terminating this session cancels its descendants, not just the pending RPC.
 * Constant script served as an asset; document bytes never become instructions.
 */
export const documentOcrWorkerSource = `
importScripts('/document-engine/ocr-library.min.js');
let engine, currentId;
onmessage = async ({data}) => {
  currentId = data.id;
  try {
    if(!engine) {
      engine = await Tesseract.createWorker('spa', Tesseract.OEM.LSTM_ONLY, {
        workerPath: location.origin + '/document-engine/ocr-worker.min.js',
        corePath: location.origin + '/document-engine/core',
        langPath: location.origin + '/document-engine/lang',
        workerBlobURL: false, cacheMethod:'none',
        logger: ({status,progress}) => {
          if(status==='recognizing text') postMessage({kind:'progress',id:currentId,progress});
        }
      });
      await engine.setParameters({preserve_interword_spaces:'1'});
    }
    const result = await engine.recognize(data.bytes, {}, {text:true});
    postMessage({kind:'result', id:data.id, text:result.data.text, confidence:result.data.confidence});
  } catch { postMessage({kind:'error',id:data.id}); }
};
`;
