import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
type Option = { value: string; label: string; disabled: boolean; group?: string };
const labelText = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? labelText(child.props.children)
        : String(child),
    )
    .join('');
function optionsFrom(children: ReactNode, group?: string, groupDisabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{ children?: ReactNode; value?: string; disabled?: boolean; label?: string }>(
        child,
      )
    )
      return [];
    if (child.type === 'optgroup')
      return optionsFrom(
        child.props.children,
        child.props.label,
        groupDisabled || !!child.props.disabled,
      );
    if (child.type !== 'option') return [];
    const label = labelText(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: groupDisabled || !!child.props.disabled,
        group,
      },
    ];
  });
}
export function Select({
  children,
  value,
  onChange,
  disabled,
  id,
  className = '',
  ...props
}: ComponentProps<'select'>) {
  const options = optionsFrom(children),
    selected = options.find((o) => o.value === String(value));
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [position, setPosition] = useState({ left: 0, top: 0, width: 200, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    listId = useId(),
    typing = useRef({ text: '', at: 0 });
  const close = () => {
    setOpen(false);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange?.({
      target: { value: option.value },
      currentTarget: { value: option.value },
    } as ChangeEvent<HTMLSelectElement>);
    close();
    trigger.current?.focus();
  };
  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === String(value) && !o.disabled),
      ),
    );
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect(),
        width = Math.min(Math.max(r.width, 220), innerWidth - 24),
        spaceBelow = innerHeight - r.bottom - 12,
        spaceAbove = r.top - 12,
        above = spaceBelow < 200 && spaceAbove > spaceBelow,
        maxHeight = Math.min(300, Math.max(80, above ? spaceAbove : spaceBelow));
      setPosition({
        left: Math.max(12, Math.min(r.left, innerWidth - width - 12)),
        top: above
          ? Math.max(12, r.top - Math.min(menu.current?.scrollHeight || 300, maxHeight) - 6)
          : r.bottom + 6,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node))
        close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector(`#${CSS.escape(listId + '-' + active)}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        id={id}
        role="combobox"
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-activedescendant={open ? listId + '-' + active : undefined}
        disabled={disabled || !options.length}
        className={'select-trigger ' + className + (open ? ' is-open' : '')}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
          }
          if (e.key === 'Tab') {
            close();
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (open) choose(active);
            else show();
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            if (!open) {
              show();
              return;
            }
            const step = e.key === 'ArrowUp' ? -1 : 1;
            let next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : active + step;
            while (next >= 0 && next < options.length && options[next].disabled)
              next += e.key === 'End' ? -1 : step;
            if (next >= 0 && next < options.length) setActive(next);
            return;
          }
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const at = Date.now();
            typing.current = {
              text: (at - typing.current.at < 600 ? typing.current.text : '') + e.key,
              at,
            };
            const index = options.findIndex(
              (o) =>
                !o.disabled &&
                o.label.toLocaleLowerCase().startsWith(typing.current.text.toLocaleLowerCase()),
            );
            if (index >= 0) {
              e.preventDefault();
              if (!open) setOpen(true);
              setActive(index);
            }
          }
        }}
      >
        <span>{selected?.label || options[0]?.label || '暂无选项'}</span>
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            aria-label={props['aria-label'] ? `${props['aria-label']}选项` : '选择选项'}
            className="select-menu"
            style={position}
          >
            {options.map((option, index) => (
              <div key={option.value + '-' + index}>
                {option.group && option.group !== options[index - 1]?.group && (
                  <div className="select-group">{option.group}</div>
                )}
                <div
                  role="option"
                  id={listId + '-' + index}
                  data-value={option.value}
                  aria-selected={option.value === String(value)}
                  aria-disabled={option.disabled}
                  className={'select-option ' + (active === index ? 'is-highlighted' : '')}
                  onPointerMove={() => {
                    if (!option.disabled) setActive(index);
                  }}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span>{option.label}</span>
                  {option.value === String(value) && <Check size={15} />}
                </div>
              </div>
            ))}
          </div>,
          trigger.current?.closest('dialog') || document.body,
        )}
    </>
  );
}
