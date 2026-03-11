import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';
import ePub from 'epubjs';
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  ListTree,
  MoonStar,
  SlidersHorizontal,
  SunMedium,
  Type,
  WholeWord
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

const bridgeApi = window.readerApi;

const EMPTY_BOOK = {
  fileName: '',
  title: 'AgentReader',
  creator: '',
  toc: [],
  spineItems: [],
  currentIndex: 0,
  currentHref: '',
  isReady: false
};

const DEFAULT_CONTROLS = {
  fontSize: 18,
  lineHeight: 1.75,
  maxWidth: 72
};

function fileTitleFromName(fileName = '') {
  return String(fileName).replace(/\.epub$/i, '') || '未命名图书';
}

function normalizeHref(value = '') {
  const input = String(value || '').split('#')[0].replace(/\\/g, '/').replace(/^\/+/, '');
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function normalizeCreator(creator) {
  if (Array.isArray(creator)) {
    return creator.map((item) => String(item).trim()).filter(Boolean).join(' / ');
  }
  return String(creator || '').trim();
}

function flattenToc(items, depth = 0, list = []) {
  for (const item of items) {
    const label = String(item?.label || '').trim() || `第 ${list.length + 1} 章`;
    list.push({
      label,
      href: item?.href || '',
      depth
    });
    if (Array.isArray(item?.subitems) && item.subitems.length > 0) {
      flattenToc(item.subitems, depth + 1, list);
    }
  }
  return list;
}

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  throw new Error('EPUB 文件数据格式无效');
}

function resolveChapterTitle(toc, spineItems, currentHref, currentIndex) {
  const normalized = normalizeHref(currentHref);
  const tocMatch = toc.find((item) => normalizeHref(item.href) === normalized);
  if (tocMatch?.label) {
    return tocMatch.label;
  }
  return spineItems[currentIndex]?.label || `第 ${currentIndex + 1} 章`;
}

function buildFallbackToc(spineItems) {
  return spineItems.map((item, index) => ({
    label: `第 ${index + 1} 章`,
    href: item?.href || '',
    depth: 0
  }));
}

function styleContents(contents, controls, theme) {
  const doc = contents?.document;
  if (!doc?.documentElement || !doc.body) {
    return;
  }

  const isDark = theme === 'dark';
  const root = doc.documentElement;
  const body = doc.body;

  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.style.backgroundColor = isDark ? '#111111' : '#ffffff';
  body.style.backgroundColor = isDark ? '#111111' : '#ffffff';
  body.style.color = isDark ? '#f5f5f5' : '#111111';
  body.style.maxWidth = `${controls.maxWidth}ch`;
  body.style.width = '100%';
  body.style.margin = '0 auto';
  body.style.padding = '40px 0 112px';
  body.style.boxSizing = 'border-box';
  body.style.fontSize = `${controls.fontSize}px`;
  body.style.lineHeight = String(controls.lineHeight);
  body.style.fontFamily = '"Source Serif 4", "Iowan Old Style", "Songti SC", serif';
  body.style.wordBreak = 'break-word';

  for (const heading of doc.querySelectorAll('h1, h2, h3, h4')) {
    heading.style.fontFamily = '"Avenir Next", "SF Pro Display", "PingFang SC", sans-serif';
    heading.style.letterSpacing = '-0.02em';
    heading.style.color = isDark ? '#ffffff' : '#111111';
  }

  for (const blockquote of doc.querySelectorAll('blockquote')) {
    blockquote.style.borderLeft = isDark ? '2px solid #4a4a4a' : '2px solid #d9d9d9';
    blockquote.style.paddingLeft = '1rem';
    blockquote.style.color = isDark ? '#d4d4d4' : '#4a4a4a';
  }

  for (const script of doc.querySelectorAll('script')) {
    script.remove();
  }

  for (const link of doc.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';
    if (/^javascript:/i.test(href)) {
      link.removeAttribute('href');
    }
    link.style.color = isDark ? '#ffffff' : '#111111';
    link.style.textDecoration = 'underline';
  }

  for (const image of Array.from(doc.images || [])) {
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
    image.style.borderRadius = '0.5rem';
  }
}

function MetaRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>
      <span className="max-w-[140px] truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function SettingBlock({ label, value, children }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{value}</span>
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const readerRootRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const controlsRef = useRef(DEFAULT_CONTROLS);
  const themeRef = useRef('light');
  const bookStateRef = useRef(EMPTY_BOOK);
  const settingsRef = useRef(null);

  const [theme, setTheme] = useState('light');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controls, setControls] = useState(DEFAULT_CONTROLS);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('请打开一本 EPUB 开始阅读');
  const [error, setError] = useState('');
  const [bookState, setBookState] = useState(EMPTY_BOOK);

  const tocItems = bookState.toc.length > 0 ? bookState.toc : buildFallbackToc(bookState.spineItems);
  const progressLabel = `${bookState.spineItems.length ? bookState.currentIndex + 1 : 0} / ${bookState.spineItems.length}`;
  const readingPercent = bookState.spineItems.length
    ? Math.round(((bookState.currentIndex + 1) / bookState.spineItems.length) * 100)
    : 0;
  const currentChapterTitle = bookState.currentHref
    ? resolveChapterTitle(tocItems, bookState.spineItems, bookState.currentHref, bookState.currentIndex)
    : '等待载入';

  const destroyReader = useEffectEvent(() => {
    if (renditionRef.current) {
      try {
        renditionRef.current.destroy();
      } catch {
        // Ignore renderer teardown errors from epub.js.
      }
    }
    if (bookRef.current) {
      try {
        bookRef.current.destroy();
      } catch {
        // Ignore book teardown errors from epub.js.
      }
    }
    renditionRef.current = null;
    bookRef.current = null;
    if (readerRootRef.current) {
      readerRootRef.current.innerHTML = '';
    }
  });

  const applyReaderTheme = useEffectEvent(() => {
    const rendition = renditionRef.current;
    if (!rendition || typeof rendition.getContents !== 'function') {
      return;
    }
    for (const contents of rendition.getContents()) {
      styleContents(contents, controlsRef.current, themeRef.current);
    }
  });

  const handleReaderError = useEffectEvent((rawError) => {
    const message = rawError?.message || String(rawError || '阅读器渲染失败');
    destroyReader();
    startTransition(() => {
      setBookState(EMPTY_BOOK);
    });
    setLoading(false);
    setError(message);
    setStatus(`打开失败：${message}`);
  });

  const handleRelocated = useEffectEvent((location) => {
    const current = bookStateRef.current;
    const href = normalizeHref(location?.start?.href || '');
    const index = typeof location?.start?.index === 'number'
      ? location.start.index
      : current.spineItems.findIndex((item) => normalizeHref(item?.href) === href);
    const nextIndex = index >= 0 ? index : current.currentIndex;
    const nextHref = href || normalizeHref(current.spineItems[nextIndex]?.href || '');
    const nextTitle = resolveChapterTitle(current.toc, current.spineItems, nextHref, nextIndex);

    startTransition(() => {
      setBookState((prev) => ({
        ...prev,
        currentIndex: nextIndex,
        currentHref: nextHref
      }));
    });
    setStatus(nextTitle);
  });

  const loadBook = useEffectEvent(async (payload) => {
    if (!payload || !readerRootRef.current) {
      return;
    }

    setLoading(true);
    setError('');
    setStatus('正在打开 EPUB ...');
    destroyReader();

    startTransition(() => {
      setBookState({
        ...EMPTY_BOOK,
        fileName: payload.fileName || '',
        title: fileTitleFromName(payload.fileName || '')
      });
    });

    try {
      const book = ePub(toArrayBuffer(payload.data));
      const rendition = book.renderTo(readerRootRef.current, {
        width: '100%',
        height: '100%',
        spread: 'none',
        manager: 'continuous',
        flow: 'scrolled-doc',
        allowScriptedContent: false
      });

      bookRef.current = book;
      renditionRef.current = rendition;

      rendition.hooks.content.register((contents) => {
        styleContents(contents, controlsRef.current, themeRef.current);
      });
      rendition.on('relocated', handleRelocated);

      const [, metadata, navigation] = await Promise.all([
        book.ready,
        book.loaded.metadata.catch(() => ({})),
        book.loaded.navigation.catch(() => ({ toc: [] }))
      ]);

      const spineItems = Array.isArray(book.spine?.spineItems) ? book.spine.spineItems : [];
      const toc = flattenToc(navigation?.toc || []);
      const initialHref = normalizeHref(spineItems[0]?.href || '');
      const initialTitle = resolveChapterTitle(toc, spineItems, initialHref, 0);

      startTransition(() => {
        setBookState({
          fileName: payload.fileName || '',
          title: String(metadata?.title || '').trim() || fileTitleFromName(payload.fileName || ''),
          creator: normalizeCreator(metadata?.creator),
          toc,
          spineItems,
          currentIndex: 0,
          currentHref: initialHref,
          isReady: true
        });
      });

      await rendition.display();
      applyReaderTheme();

      setLoading(false);
      setStatus(initialTitle);
    } catch (readerError) {
      handleReaderError(readerError);
    }
  });

  const openFromDialog = useEffectEvent(async () => {
    if (!bridgeApi?.openEpubDialog) {
      handleReaderError('Electron bridge 未就绪');
      return;
    }
    const payload = await bridgeApi.openEpubDialog();
    if (payload) {
      await loadBook(payload);
    }
  });

  const openFromPath = useEffectEvent(async (filePath) => {
    if (!filePath || !bridgeApi?.readEpubFile) {
      return;
    }
    const payload = await bridgeApi.readEpubFile(filePath);
    if (payload) {
      await loadBook(payload);
    }
  });

  const displaySpineIndex = useEffectEvent((index) => {
    const rendition = renditionRef.current;
    const target = bookStateRef.current.spineItems[index];
    if (!rendition || !target?.href) {
      return;
    }
    rendition.display(target.href).catch(handleReaderError);
  });

  const goPrev = useEffectEvent(() => {
    renditionRef.current?.prev().catch(handleReaderError);
  });

  const goNext = useEffectEvent(() => {
    renditionRef.current?.next().catch(handleReaderError);
  });

  useEffect(() => {
    controlsRef.current = controls;
    applyReaderTheme();
  }, [controls]);

  useEffect(() => {
    themeRef.current = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    applyReaderTheme();
  }, [theme]);

  useEffect(() => {
    bookStateRef.current = bookState;
  }, [bookState]);

  useEffect(() => {
    if (!bridgeApi?.onMenuOpenEpub) {
      return undefined;
    }
    return bridgeApi.onMenuOpenEpub(() => {
      void openFromDialog();
    });
  }, []);

  useEffect(() => {
    const onDrop = (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file?.path) {
        void openFromPath(file.path);
      }
    };

    const onDragOver = (event) => {
      event.preventDefault();
    };

    const onKeyDown = (event) => {
      if (!bookStateRef.current.isReady) {
        return;
      }
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          return;
        }
      }
      if (event.key === 'ArrowLeft') {
        goPrev();
      } else if (event.key === 'ArrowRight') {
        goNext();
      }
    };

    const onPointerDown = (event) => {
      if (!settingsRef.current) {
        return;
      }
      if (!settingsRef.current.contains(event.target)) {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      destroyReader();
    };
  }, []);

  return (
    <div className="grid h-screen grid-cols-[300px_minmax(0,1fr)] bg-background text-foreground">
      <aside className="flex min-h-0 flex-col border-r border-border bg-muted/20">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Library</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight">Contents</h1>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full bg-background"
            onClick={() => {
              void openFromDialog();
            }}
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>

        <div className="px-4 py-4">
          <Card className="rounded-2xl border-border bg-background shadow-none">
            <CardHeader className="p-4">
              <div className="mb-2 inline-flex size-10 items-center justify-center rounded-xl border border-border bg-background">
                <BookOpenText className="size-5" />
              </div>
              <CardTitle className="line-clamp-2 text-lg">{bookState.title || '打开一本 EPUB'}</CardTitle>
              <CardDescription className="line-clamp-3">
                {bookState.creator || '左侧只保留目录和图书信息，正文区域不再被辅助面板切碎。'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <MetaRow icon={FileText} label="文件" value={bookState.fileName || '未选择'} />
              <MetaRow icon={Clock3} label="进度" value={`${readingPercent}%`} />
              <MetaRow icon={BookOpenText} label="章节" value={String(bookState.spineItems.length || 0)} />
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between px-5 pb-3 pt-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <ListTree className="size-3.5" />
            <span>Table of contents</span>
          </div>
          <Badge variant="outline" className="rounded-full bg-background">
            {progressLabel}
          </Badge>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-3 pb-4">
          <div className="space-y-1 px-2">
            {tocItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground">
                打开书籍后，这里会显示章节目录。
              </div>
            ) : (
              tocItems.map((item) => {
                const active = normalizeHref(item.href) === bookState.currentHref;
                return (
                  <button
                    key={`${item.href}-${item.label}`}
                    type="button"
                    onClick={() => {
                      const targetIndex = bookState.spineItems.findIndex(
                        (spineItem) => normalizeHref(spineItem?.href) === normalizeHref(item.href)
                      );
                      if (targetIndex >= 0) {
                        displaySpineIndex(targetIndex);
                      }
                    }}
                    className={cn(
                      'flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                      active
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground'
                    )}
                    style={{ paddingLeft: `${12 + item.depth * 14}px` }}
                  >
                    <span className="line-clamp-2">{item.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </aside>

      <main className="flex min-h-0 flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border px-8 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-lg font-semibold tracking-tight text-foreground">{currentChapterTitle}</p>
              <Badge variant="outline" className="rounded-full bg-background">
                {progressLabel}
              </Badge>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{status}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full bg-background"
              disabled={!bookState.isReady}
              onClick={goPrev}
            >
              <ChevronLeft className="size-4" />
              上一章
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full bg-background"
              disabled={!bookState.isReady}
              onClick={goNext}
            >
              下一章
              <ChevronRight className="size-4" />
            </Button>

            <div className="relative" ref={settingsRef}>
              <Button
                variant="outline"
                size="icon"
                className="rounded-full bg-background"
                onClick={() => {
                  setSettingsOpen((current) => !current);
                }}
              >
                <SlidersHorizontal className="size-4" />
              </Button>

              {settingsOpen && (
                <Card className="absolute right-0 top-12 z-20 w-[320px] rounded-2xl border-border bg-background shadow-[0_18px_48px_rgba(0,0,0,0.12)]">
                  <CardHeader className="p-4">
                    <CardTitle className="text-base">阅读设置</CardTitle>
                    <CardDescription>右上角集中管理字号、行高、宽度和黑白主题。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 p-4 pt-0">
                    <SettingBlock label="字体大小" value={`${controls.fontSize}px`}>
                      <Slider
                        value={[controls.fontSize]}
                        min={14}
                        max={30}
                        step={1}
                        onValueChange={(value) => {
                          setControls((current) => ({ ...current, fontSize: value[0] || 18 }));
                        }}
                      />
                    </SettingBlock>

                    <SettingBlock label="行高" value={controls.lineHeight.toFixed(2)}>
                      <Slider
                        value={[controls.lineHeight]}
                        min={1.4}
                        max={2.2}
                        step={0.05}
                        onValueChange={(value) => {
                          setControls((current) => ({ ...current, lineHeight: value[0] || 1.75 }));
                        }}
                      />
                    </SettingBlock>

                    <SettingBlock label="阅读宽度" value={`${controls.maxWidth}ch`}>
                      <Slider
                        value={[controls.maxWidth]}
                        min={48}
                        max={92}
                        step={1}
                        onValueChange={(value) => {
                          setControls((current) => ({ ...current, maxWidth: value[0] || 72 }));
                        }}
                      />
                    </SettingBlock>

                    <div className="space-y-2 rounded-xl border border-border bg-background p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">主题</span>
                        <span className="font-medium text-foreground">{theme === 'dark' ? '深色' : '浅色'}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant={theme === 'light' ? 'default' : 'outline'}
                          size="sm"
                          className="flex-1 rounded-full"
                          onClick={() => {
                            setTheme('light');
                          }}
                        >
                          <SunMedium className="size-4" />
                          浅色
                        </Button>
                        <Button
                          variant={theme === 'dark' ? 'default' : 'outline'}
                          size="sm"
                          className="flex-1 rounded-full"
                          onClick={() => {
                            setTheme('dark');
                          }}
                        >
                          <MoonStar className="size-4" />
                          深色
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-6 py-6">
          <Card className="h-full overflow-hidden rounded-2xl border-border bg-background shadow-none">
            <CardContent className="relative h-full p-0">
              <div
                ref={readerRootRef}
                className={cn(
                  'epub-stage h-full w-full',
                  !bookState.isReady && 'opacity-0'
                )}
              />

              {!bookState.isReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
                  <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-border bg-background">
                    <BookOpenText className="size-6" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                      {loading ? '正在加载书籍…' : '打开一本书，开始阅读'}
                    </h2>
                    <p className="max-w-xl text-sm leading-7 text-muted-foreground">
                      {error || '去掉内部窗口与多余分栏后，阅读区域现在是单一主舞台。'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      className="rounded-full"
                      onClick={() => {
                        void openFromDialog();
                      }}
                    >
                      <FolderOpen className="size-4" />
                      打开 EPUB
                    </Button>
                    <Badge variant="outline" className="rounded-full bg-background px-3 py-1">
                      <Type className="mr-1 size-3.5" />
                      字体与宽度在右上角设置
                    </Badge>
                    <Badge variant="outline" className="rounded-full bg-background px-3 py-1">
                      <WholeWord className="mr-1 size-3.5" />
                      黑白配色
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
