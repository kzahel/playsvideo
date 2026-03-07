import { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';
import { runFfmpegAudioTranscode } from './pipeline/audio-transcode.js';
import type {
  ConnectTranscodeWorkerMessage,
  TranscodeJobRequest,
  TranscodeJobResponse,
} from './transcode-protocol.js';

const ffmpeg = new WasmFfmpegRunner();
let port: MessagePort | null = null;

self.onmessage = (event: MessageEvent<ConnectTranscodeWorkerMessage>) => {
  if (event.data?.type !== 'connect' || event.ports.length === 0) {
    return;
  }

  port = event.ports[0];
  port.onmessage = (messageEvent: MessageEvent<TranscodeJobRequest>) => {
    void handleJob(messageEvent.data);
  };
  port.start?.();
};

async function handleJob(msg: TranscodeJobRequest): Promise<void> {
  if (!port || msg.type !== 'transcode-job') {
    return;
  }

  try {
    if (msg.sourceCodec) {
      await ffmpeg.loadForCodec(msg.sourceCodec);
    }
    const result = await runFfmpegAudioTranscode({
      ffmpeg,
      inputData: new Uint8Array(msg.inputData),
      sourceCodec: msg.sourceCodec,
    });
    const outputData = new Uint8Array(result.aacData);
    const outputBuffer = outputData.buffer;
    const response: TranscodeJobResponse = {
      type: 'transcode-result',
      jobId: msg.jobId,
      ok: true,
      outputData: outputBuffer,
      metrics: result.metrics,
    };
    port.postMessage(response, [outputBuffer]);
  } catch (err) {
    const response: TranscodeJobResponse = {
      type: 'transcode-result',
      jobId: msg.jobId,
      ok: false,
      error: String(err),
    };
    port.postMessage(response);
  }
}
