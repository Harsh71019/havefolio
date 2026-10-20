'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { validBarcode } from '@havefolio/domain';
interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface DetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}
/** Camera frames stay in this browser. Scanning never submits an enrichment request. */
export function BarcodeCamera({
  onChoose,
}: {
  onChoose: (value: string) => void;
}): React.JSX.Element {
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef(0);
  const [active, setActive] = useState(false),
    [message, setMessage] = useState(
      'Camera scanning needs HTTPS and a browser with BarcodeDetector. Manual entry is always available.',
    ),
    [codes, setCodes] = useState<string[]>([]);
  const stop = useCallback((): void => {
    generation.current++;
    clearTimeout(watchdog.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setActive(false);
  }, []);
  useEffect(() => {
    const hide = (): void => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [stop]);
  const start = async (): Promise<void> => {
    stop();
    const current = ++generation.current;
    const Detector = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    if (!window.isSecureContext || !Detector || !navigator.mediaDevices?.getUserMedia) {
      setMessage(
        'Camera scanning is unavailable here. Use HTTPS in a supported browser, or type the barcode below.',
      );
      return;
    }
    setActive(true);
    setCodes([]);
    try {
      const formats = (await Detector.getSupportedFormats()).filter((f) =>
        ['ean_8', 'ean_13', 'upc_a'].includes(f),
      );
      if (current !== generation.current) return;
      if (!formats.length) throw new Error();
      const capture = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (current !== generation.current) {
        capture.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = capture;
      watchdog.current = setTimeout(() => {
        if (current === generation.current) {
          stop();
          setMessage('Scanning stopped after 30 seconds. Try again or type the barcode.');
        }
      }, 30000);
      if (!video.current) {
        stop();
        return;
      }
      video.current.srcObject = capture;
      await video.current.play();
      if (current !== generation.current) return;
      const detector = new Detector({ formats }),
        deadline = Date.now() + 30000;
      setMessage(
        'Point the camera at a food barcode. Choose a detected code, then request suggestions separately.',
      );
      const scan = async (): Promise<void> => {
        if (current !== generation.current || !video.current) return;
        if (Date.now() > deadline) {
          stop();
          setMessage('Scanning stopped after 30 seconds. Try again or type the barcode.');
          return;
        }
        try {
          const found = await detector.detect(video.current);
          if (current !== generation.current) return;
          const values = [...new Set(found.map((f) => f.rawValue).filter(validBarcode))].slice(
            0,
            5,
          );
          if (values.length) {
            setCodes(values);
            stop();
            setMessage('Check the printed barcode and choose a code. Nothing has been sent.');
            return;
          }
          window.setTimeout(() => void scan(), 500);
        } catch {
          if (current === generation.current) {
            stop();
            setMessage('Could not decode this barcode. Try manual entry.');
          }
        }
      };
      void scan();
    } catch {
      if (current === generation.current) {
        stop();
        setMessage(
          'Camera access or decoding is unavailable. Check permission or use manual entry.',
        );
      }
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" role="status">
        {message}
      </p>
      <Button type="button" variant="outline" onClick={() => (active ? stop() : void start())}>
        {active ? 'Stop camera' : 'Scan barcode'}
      </Button>
      <video
        ref={video}
        hidden={!active}
        muted
        playsInline
        aria-label="Barcode camera preview"
        className="max-h-64 w-full rounded-md"
      />
      {codes.map((code) => (
        <Button
          key={code}
          type="button"
          variant="outline"
          onClick={() => {
            onChoose(code);
            setCodes([]);
          }}
          className="mr-2"
        >
          Use {code}
        </Button>
      ))}
    </div>
  );
}
