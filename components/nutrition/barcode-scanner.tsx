'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Capacitor } from '@capacitor/core'

interface Props {
  onResult: (code: string) => void
  onClose: () => void
}

async function stopNative() {
  // Bundle the plugin's JS proxy so this dynamic import resolves inside the
  // Capacitor WebView. With webpackIgnore the runtime sees a bare specifier it
  // can't resolve, the import throws, and the scanner reports "unavailable".
  const { BarcodeScanner: CapScanner } = await import('@capacitor-community/barcode-scanner').catch(() => ({ BarcodeScanner: null }))
  if (!CapScanner) return
  CapScanner.stopScan().catch(() => {})
  CapScanner.showBackground().catch(() => {})
  document.documentElement.style.background = ''
  document.documentElement.style.backgroundColor = ''
  document.body.style.background = ''
  document.body.style.backgroundColor = ''
  document.body.classList.remove('scanner-active')
  document.getElementById('scanner-hide-style')?.remove()
  document.querySelectorAll<HTMLElement>('[data-scanner-transparent]').forEach(el => {
    el.style.background = ''
    el.style.backgroundColor = ''
    el.removeAttribute('data-scanner-transparent')
  })
}

export function BarcodeScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let stopped = false

    async function startNative() {
      const { BarcodeScanner: CapScanner } = await import('@capacitor-community/barcode-scanner').catch(() => ({ BarcodeScanner: null }))
      if (!CapScanner) { setError('Barcode scanner unavailable'); return }
      try {
        const status = await CapScanner.checkPermission({ force: true })
        if (status.denied) {
          setError('Camera permission denied. Enable it in Android settings.')
          return
        }

        // Make every stacking context transparent so camera can show through
        document.documentElement.style.background = 'transparent'
        document.documentElement.style.backgroundColor = 'transparent'
        document.body.style.background = 'transparent'
        document.body.style.backgroundColor = 'transparent'
        // Walk up and clear background on all fixed/absolute parents
        document.querySelectorAll<HTMLElement>('[class*="bg-"]').forEach(el => {
          const computed = getComputedStyle(el).backgroundColor
          if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') {
            el.style.backgroundColor = 'transparent'
            el.setAttribute('data-scanner-transparent', '1')
          }
        })

        // Inject a style that hides all body children except our scanner overlay
        const style = document.createElement('style')
        style.id = 'scanner-hide-style'
        style.textContent = 'body.scanner-active > *:not([data-scanner-overlay]) { visibility: hidden !important; }'
        document.head.appendChild(style)
        document.body.classList.add('scanner-active')

        await CapScanner.hideBackground()
        setScanning(true)

        const result = await CapScanner.startScan()

        stopNative()

        if (!stopped && result.hasContent) {
          onResult(result.content)
        } else if (!stopped) {
          onClose()
        }
      } catch (e) {
        stopNative()
        if (!stopped) setError('Barcode scanner failed: ' + String(e))
      }
    }

    async function startWeb() {
      try {
        setScanning(true)
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
        reader.decodeFromVideoElement(videoRef.current!, (result) => {
          if (stopped) return
          if (result) {
            stopped = true
            stream.getTracks().forEach(t => t.stop())
            onResult(result.getText())
          }
        })
        return () => {
          stopped = true
          stream.getTracks().forEach(t => t.stop())
        }
      } catch {
        setError('Camera access denied. Please allow camera in browser settings.')
      }
    }

    let cleanup: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      startNative()
    } else {
      startWeb().then(fn => { cleanup = fn })
    }

    return () => {
      stopped = true
      if (Capacitor.isNativePlatform()) stopNative()
      cleanup?.()
    }
  }, [onResult, onClose])

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    )
  }

  // Native: portal to document.body so no parent background can block the camera
  if (Capacitor.isNativePlatform() && mounted) {
    return createPortal(
      <div
        data-scanner-overlay
        className="fixed inset-0 z-[999] flex flex-col items-center justify-between pb-[calc(4rem+var(--safe-bottom))] pt-[calc(3rem+var(--safe-top))]"
        style={{ background: 'transparent' }}
      >
        <p className="text-white text-sm bg-black/50 px-4 py-2 rounded-full">
          Point at a barcode
        </p>
        {scanning && (
          <div className="w-64 h-64 border-2 border-white rounded-2xl" />
        )}
        <Button
          variant="ghost"
          className="bg-black/60 text-white hover:bg-black/80 px-8"
          onClick={() => { stopNative(); onClose() }}
        >
          <X className="w-4 h-4 mr-2" /> Cancel
        </Button>
      </div>,
      document.body
    )
  }

  // Web / PWA fallback
  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
      {scanning && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-48 h-48 border-2 border-white/60 rounded-xl" />
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close scanner"
        className="absolute top-2 right-2 bg-black/40 hover:bg-black/60 text-white"
        onClick={onClose}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  )
}
