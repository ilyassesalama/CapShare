import { describe, expect, it } from 'vitest'
import { DRAFT_PATH_PLACEHOLDER } from '../src/main/core/capcut/constants'
import {
  classifyString,
  collectPaths,
  makeRewriter,
  walkJsonStrings
} from '../src/main/core/capcut/scanner'

describe('classifyString', () => {
  it('recognizes placeholder paths as portable', () => {
    const value = `${DRAFT_PATH_PLACEHOLDER}/Resources/local/abc.mp4`
    expect(classifyString(value).cls).toBe('placeholder')
  })

  it('never classifies URLs as paths', () => {
    expect(classifyString('https://p16-sg.example.com/img.png?x=1').cls).toBe('url')
    expect(classifyString('file:///Users/x/video.mp4').cls).toBe('url')
    expect(classifyString('s3+custom://bucket/key').cls).toBe('url')
  })

  it('classifies mac container effect-cache paths with suffix', () => {
    const value =
      '/Users/u/Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect/123/abc'
    const result = classifyString(value)
    expect(result.cls).toBe('effect-cache')
    expect(result.cacheSuffix).toBe('effect/123/abc')
  })

  it('classifies windows effect-cache paths (forward slashes and backslashes)', () => {
    const forward = 'C:/Users/T/AppData/Local/CapCut/User Data/Cache/artistEffect/9/ff'
    expect(classifyString(forward)).toMatchObject({
      cls: 'effect-cache',
      cacheSuffix: 'artistEffect/9/ff'
    })
    const backslashes = 'C:\\Users\\T\\AppData\\Local\\CapCut\\User Data\\Cache\\effect\\9\\aa'
    expect(classifyString(backslashes)).toMatchObject({
      cls: 'effect-cache',
      cacheSuffix: 'effect/9/aa'
    })
  })

  it('classifies absolute paths on any windows drive letter', () => {
    expect(classifyString('D:/Footage/clip.wav').cls).toBe('absolute')
    expect(classifyString('Z:\\renders\\out.mp4').cls).toBe('absolute')
  })

  it('flags UNC paths separately', () => {
    expect(classifyString('\\\\server\\share\\clip.mp4').cls).toBe('unc')
  })

  it('detects draft-internal absolute paths case-insensitively', () => {
    const ctx = {
      draftFolderJson: '/Users/u/Movies/CapCut/User Data/Projects/com.lveditor.draft/My Project'
    }
    const result = classifyString(
      '/users/u/movies/capcut/user data/projects/com.lveditor.draft/my project/Resources/local/a.mp4',
      ctx
    )
    expect(result.cls).toBe('draft-internal')
    expect(result.draftRelative).toBe('Resources/local/a.mp4')
  })

  it('treats plain strings and relative paths as relative', () => {
    expect(classifyString('clip-one.mp4').cls).toBe('relative')
    expect(classifyString('./Resources/local/a.mp4').cls).toBe('relative')
    expect(classifyString('').cls).toBe('relative')
    expect(classifyString('/').cls).toBe('relative')
  })
})

describe('walkJsonStrings', () => {
  it('walks nested objects and arrays and applies replacements', () => {
    const doc = {
      a: '/abs/one',
      nested: { list: ['/abs/two', { deep: '/abs/three' }] },
      keep: 'hello'
    }
    const changed = walkJsonStrings(doc, (value) =>
      value.startsWith('/abs/') ? value.replace('/abs/', '/new/') : undefined
    )
    expect(changed).toBe(true)
    expect(doc.a).toBe('/new/one')
    expect(doc.nested.list[0]).toBe('/new/two')
    expect((doc.nested.list[1] as { deep: string }).deep).toBe('/new/three')
    expect(doc.keep).toBe('hello')
  })

  it('rewrites paths inside embedded JSON strings', () => {
    const doc = {
      content: JSON.stringify({ media: { path: '/old/root/file.mp4' }, text: 'hi' })
    }
    const changed = walkJsonStrings(doc, (value) =>
      value === '/old/root/file.mp4' ? '/new/root/file.mp4' : undefined
    )
    expect(changed).toBe(true)
    expect(JSON.parse(doc.content)).toEqual({ media: { path: '/new/root/file.mp4' }, text: 'hi' })
  })

  it('leaves invalid embedded JSON untouched', () => {
    const doc = { broken: '{not json/with/slash' }
    const changed = walkJsonStrings(doc, () => undefined)
    expect(changed).toBe(false)
    expect(doc.broken).toBe('{not json/with/slash')
  })
})

describe('collectPaths', () => {
  it('collects only non-relative classifications with pointers', () => {
    const doc = {
      materials: {
        stickers: [
          {
            path: '/Users/u/Movies/CapCut/User Data/Cache/effect/1/a',
            icon_url: 'https://cdn.example.com/i.png'
          }
        ]
      },
      name: 'plain'
    }
    const found = collectPaths(doc)
    const classes = found.map((f) => f.cls).sort()
    expect(classes).toEqual(['effect-cache', 'url'])
    const cache = found.find((f) => f.cls === 'effect-cache')
    expect(cache?.pointer).toBe('/materials/stickers/0/path')
  })
})

describe('makeRewriter', () => {
  it('applies prefix rules and emits forward slashes', () => {
    const rewrite = makeRewriter([
      {
        kind: 'prefix',
        from: 'C:/Users/Old/AppData/Local/CapCut/User Data/Cache',
        to: '/Users/new/Library/CapCut/Cache',
        caseInsensitive: true
      }
    ])
    expect(rewrite('C:\\Users\\OLD\\AppData\\Local\\CapCut\\User Data\\Cache\\effect\\1\\a')).toBe(
      '/Users/new/Library/CapCut/Cache/effect/1/a'
    )
  })

  it('never rewrites URLs even when a rule prefix matches', () => {
    const rewrite = makeRewriter([{ kind: 'prefix', from: 'https:/', to: '/oops' }])
    expect(rewrite('https://cdn.example.com/x.png')).toBeUndefined()
  })

  it('applies exact rules', () => {
    const rewrite = makeRewriter([
      { kind: 'exact', from: 'D:\\Footage\\a.wav', to: '/imported/a.wav' }
    ])
    expect(rewrite('D:/Footage/a.wav')).toBe('/imported/a.wav')
    expect(rewrite('D:/Footage/b.wav')).toBeUndefined()
  })

  it('does not fire prefix rules on partial path segments', () => {
    const rewrite = makeRewriter([{ kind: 'prefix', from: '/Users/old/Movies', to: '/x' }])
    expect(rewrite('/Users/old/MoviesBackup/file.mp4')).toBeUndefined()
    expect(rewrite('/Users/old/Movies/file.mp4')).toBe('/x/file.mp4')
  })
})
