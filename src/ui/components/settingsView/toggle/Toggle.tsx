import "./Toggle.css";
import SettingLabel from "../SettingLabel";

type ToggleProps = {
  id: string;
  label?: string;
  help?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
};

function Toggle({ id, label, help, checked, onToggle, disabled = false }: ToggleProps) {
  return (
    <div className="toggleSwitch">
      {label && <SettingLabel htmlFor={id} label={label} help={help} />}
      <input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
    </div>
  );
}

export default Toggle;
