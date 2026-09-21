/**
 * Native capability wrappers. Each uses the Capacitor plugin when running in
 * the iPad shell and falls back to browser APIs in a plain web build, so the
 * same code runs in Playwright and in the app.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

export const network = {
  async isOnline(): Promise<boolean> {
    if (isNative) {
      const { Network } = await import('@capacitor/network');
      return (await Network.getStatus()).connected;
    }
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  },
  onChange(handler: (online: boolean) => void) {
    if (isNative) {
      void import('@capacitor/network').then(({ Network }) => Network.addListener('networkStatusChange', (s) => handler(s.connected)));
      return;
    }
    window.addEventListener('online', () => handler(true));
    window.addEventListener('offline', () => handler(false));
  },
};

export const haptics = {
  async tap() { if (!isNative) return; const { Haptics, ImpactStyle } = await import('@capacitor/haptics'); await Haptics.impact({ style: ImpactStyle.Light }); },
  async success() { if (!isNative) return; const { Haptics, NotificationType } = await import('@capacitor/haptics'); await Haptics.notification({ type: NotificationType.Success }); },
  async warning() { if (!isNative) return; const { Haptics, NotificationType } = await import('@capacitor/haptics'); await Haptics.notification({ type: NotificationType.Warning }); },
};

export interface CapturedPhoto { blob: Blob; filename: string; contentType: string; takenAt: string; latitude?: number | null; longitude?: number | null; width?: number | null; height?: number | null }

export const camera = {
  /** Take a photo (camera) or pick from the library. Web fallback uses a file input with capture. */
  async capture(source: 'camera' | 'library' = 'camera'): Promise<CapturedPhoto | null> {
    if (isNative) {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos, quality: 85, correctOrientation: true, saveToGallery: false });
      const res = await fetch(photo.webPath!);
      const blob = await res.blob();
      const pos = await location.current();
      return { blob, filename: `IMG_${Date.now()}.${photo.format}`, contentType: blob.type || `image/${photo.format}`, takenAt: new Date().toISOString(), latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null };
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.setAttribute('capture', 'environment');
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const pos = await location.current();
        resolve({ blob: file, filename: file.name, contentType: file.type, takenAt: new Date(file.lastModified).toISOString(), latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null });
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
  async pickFiles(accept = '*/*', multiple = true): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = () => resolve(Array.from(input.files ?? []));
      input.oncancel = () => resolve([]);
      input.click();
    });
  },
};

export const location = {
  async current(): Promise<{ latitude: number; longitude: number } | null> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 2500);
      navigator.geolocation.getCurrentPosition((p) => { clearTimeout(t); resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }); }, () => { clearTimeout(t); resolve(null); }, { maximumAge: 60_000, timeout: 2000 });
    });
  },
};

export const voice = {
  supported(): boolean { return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition); },
  /** Dictate text using the platform speech recogniser (Safari/WebKit on iPadOS). */
  start(onText: (text: string, final: boolean) => void): { stop(): void } | null {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    rec.onresult = (e: any) => { let text = ''; let final = false; for (const r of e.results) { text += r[0].transcript; if (r.isFinal) final = true; } onText(text, final); };
    rec.start();
    return { stop: () => rec.stop() };
  },
};

export const shell = {
  async init() {
    if (!isNative) return;
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Default }).catch(() => {});
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});
  },
};
