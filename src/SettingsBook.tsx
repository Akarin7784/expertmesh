import { Children, useState, type ReactElement, type ReactNode } from 'react';

const chapters = [
  { id: 'models', title: '模型与服务商', note: '选择与你一起工作的模型。' },
  { id: 'tools', title: '工具与权限', note: '连接资料，让每位助手拥有合适的工具。' },
  { id: 'search', title: '联网搜索', note: '为对话与研究找到更多来源。' },
  { id: 'execution', title: '执行与工作区', note: '安排任务额度，连接项目与执行环境。' },
  { id: 'appearance', title: '阅读与外观', note: '选择适合此刻的阅读环境。' },
  { id: 'data', title: '数据管理', note: '保存你的对话、资料与工作成果。' },
] as const;
type ChapterId = (typeof chapters)[number]['id'];

export function SettingsChapter({ children }: { id: ChapterId; children: ReactNode }) {
  return <>{children}</>;
}

export function SettingsBook({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ChapterId>('models');
  return (
    <div className="page-inner settings-page settings-book">
      <header className="book-heading">
        <p className="book-eyebrow">工作手记 · 05 / PREFERENCES</p>
        <h1>设置</h1>
        <p>按照你的习惯，安排模型、工具与阅读方式。</p>
      </header>
      <div className="book-layout">
        <nav className="book-index" aria-label="设置目录">
          <p className="book-index-label">目录</p>
          <div role="tablist" aria-label="设置功能区" aria-orientation="vertical">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                role="tab"
                id={'settings-tab-' + chapter.id}
                aria-controls={'settings-panel-' + chapter.id}
                aria-selected={active === chapter.id}
                tabIndex={active === chapter.id ? 0 : -1}
                onClick={() => setActive(chapter.id)}
                onKeyDown={(event) => {
                  let next = index;
                  if (['ArrowDown', 'ArrowRight'].includes(event.key))
                    next = (index + 1) % chapters.length;
                  else if (['ArrowUp', 'ArrowLeft'].includes(event.key))
                    next = (index + chapters.length - 1) % chapters.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = chapters.length - 1;
                  else return;
                  event.preventDefault();
                  setActive(chapters[next].id);
                  const buttons =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role=tab]',
                    );
                  buttons?.[next].focus();
                }}
              >
                <span className="chapter-number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {chapter.title}
              </button>
            ))}
          </div>
        </nav>
        <div className="book-pages">
          {Children.map(children, (child) => {
            const element = child as ReactElement<{ id: ChapterId }>;
            const chapter = chapters.find((c) => c.id === element.props.id)!;
            return (
              <section
                role="tabpanel"
                id={'settings-panel-' + chapter.id}
                aria-labelledby={'settings-tab-' + chapter.id}
                hidden={active !== chapter.id}
                tabIndex={0}
                className="book-page"
              >
                <p className="chapter-intro">{chapter.note}</p>
                {element}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
