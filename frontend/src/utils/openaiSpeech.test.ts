import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestOpenAISpeechAudio } from './openaiSpeech'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openaiSpeech', () => {
  it('calls external TTS API directly with browser apiKey', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }),
      headers: new Headers(),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const blob = await requestOpenAISpeechAudio({
      baseUrl: 'https://api.example.com',
      apiKey: 'browser-key',
      input: '你好',
      model: 'tts-1',
      voice: 'alloy',
      format: 'mp3',
      speed: 1,
    })

    expect(blob.type).toBe('audio/mpeg')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer browser-key',
          'Content-Type': 'application/json',
        }),
      }),
    )
    const init = fetchMock.mock.calls[0]?.[1] as unknown as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      input: '你好',
      model: 'tts-1',
      voice: 'alloy',
      response_format: 'mp3',
      speed: 1,
    })
  })
})

function installLocalStorage() {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => memory.get(key) || null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
    configurable: true,
  })
}
