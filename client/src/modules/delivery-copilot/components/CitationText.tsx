import { Fragment, useMemo } from 'react';

type CitationTextProps = {
    text: string;
    /** 当前 Run 的 sources 数量；citation 编号超出范围时不渲染为可点击 */
    sourceCount: number;
    /** 锚点前缀，与 RagDebugPanel 的 <article id={`src-${index}`}> 保持一致 */
    anchorPrefix?: string;
};

const CITATION_PATTERN = /\[(\d{1,2})\]/g;
const HIGHLIGHT_CLASS = 'citation-target-highlight';
const HIGHLIGHT_MS = 1600;

export function scrollToSource(sourceIndex: number, anchorPrefix = 'src') {
    const target = document.getElementById(`${anchorPrefix}-${sourceIndex}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove(HIGHLIGHT_CLASS);
    // 强制 reflow 以便重复点击同一 citation 时重放高亮动画
    void target.offsetWidth;
    target.classList.add(HIGHLIGHT_CLASS);
    window.setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
}

/**
 * 把答案文本中的 [n] 渲染为可点击 citation：
 * 点击 [1] 滚动并高亮 RagDebugPanel 中的 src-0，以此类推。
 * 编号超出 sourceCount 的 [n]（LLM 幻觉引用或普通方括号）保持纯文本。
 */
export function CitationText({ text, sourceCount, anchorPrefix = 'src' }: CitationTextProps) {
    const parts = useMemo(() => {
        const segments: Array<{ type: 'text'; value: string } | { type: 'citation'; num: number }> = [];
        let lastIndex = 0;
        for (const match of text.matchAll(CITATION_PATTERN)) {
            const num = Number(match[1]);
            const valid = num >= 1 && num <= sourceCount;
            if (!valid) continue;
            if (match.index! > lastIndex) {
                segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
            }
            segments.push({ type: 'citation', num });
            lastIndex = match.index! + match[0].length;
        }
        if (lastIndex < text.length) {
            segments.push({ type: 'text', value: text.slice(lastIndex) });
        }
        return segments;
    }, [text, sourceCount]);

    if (!text) return null;

    return (
        <>
            {parts.map((part, index) =>
                part.type === 'text' ? (
                    <Fragment key={index}>{part.value}</Fragment>
                ) : (
                    <button
                        key={index}
                        type="button"
                        className="citation-link"
                        title={`跳转到引用来源 [${part.num}]`}
                        aria-label={`跳转到引用来源 ${part.num}`}
                        onClick={() => scrollToSource(part.num - 1, anchorPrefix)}
                    >
                        {part.num}
                    </button>
                )
            )}
        </>
    );
}
