import { useRef, type InputHTMLAttributes } from "react";
import { t } from "@webview/i18n";
import "./NumberInput.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export default function NumberInput(props: Props) {
  const input = useRef<HTMLInputElement>(null);
  const value = Number(props.value);
  const minimum = props.min === undefined ? NaN : Number(props.min);
  const maximum = props.max === undefined ? NaN : Number(props.max);
  const disabled = props.disabled || props.readOnly;
  const change = (direction: number) => {
    const node = input.current;
    if (!node || disabled) {return;}
    node.focus();
    const before = node.value;
    node.stepUp(direction);
    if (node.value !== before) {node.dispatchEvent(new Event("input", { bubbles: true }));}
  };
  return (
    <div className="numberInput">
      <input {...props} ref={input} type="number" />
      <div className="numberInputControls">
        <button type="button" tabIndex={-1} aria-label={t("settings.number.increase")} aria-controls={props.id}
          disabled={disabled || (Number.isFinite(maximum) && value >= maximum)}
          onMouseDown={(event) => event.preventDefault()} onClick={() => change(1)}>
          <span className="codicon codicon-chevron-up" aria-hidden="true" />
        </button>
        <button type="button" tabIndex={-1} aria-label={t("settings.number.decrease")} aria-controls={props.id}
          disabled={disabled || (Number.isFinite(minimum) && value <= minimum)}
          onMouseDown={(event) => event.preventDefault()} onClick={() => change(-1)}>
          <span className="codicon codicon-chevron-down" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
