import "./Slider.css";
import { SettingsField } from "../form/SettingsForm";

type SliderProps = {
  id?: string;
  label?: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onBlur?: (value: number) => void;
};

function parseSliderValue(value: string): number | undefined {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function Slider({ id, label, value, min, max, step, disabled = false, onChange, onBlur }: SliderProps) {
  return (
    <SettingsField className="slider" label={label} htmlFor={id}>
      <div className="sliderWithValue">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const nextValue = parseSliderValue(event.target.value);
            if (nextValue !== undefined) {
              onChange(nextValue);
            }
          }}
          onBlur={(event) => {
            const nextValue = parseSliderValue(event.target.value);
            if (nextValue !== undefined) {
              onBlur?.(nextValue);
            }
          }}
        />
        {value !== undefined && <span className="sliderValue">{value.toFixed(2)}</span>}
      </div>
    </SettingsField>
  );
}

export default Slider;
