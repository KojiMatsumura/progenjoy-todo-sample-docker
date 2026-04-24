"use client";

import { useId } from "react";

type PrivacyModeToggleProps = {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
};

/** ON 時は子 iframe からの api_id 1/2 をサーバーに送らない（親側で制御） */
export function PrivacyModeToggle({
  enabled,
  onEnabledChange,
}: PrivacyModeToggleProps) {
  const labelId = useId();
  const tooltipId = useId();

  return (
    <div className="privacyModeToggle">
      <div className="privacyModeToggleHeading">
        <span
          id={labelId}
          className={
            "privacyModeToggleLabel" +
            (enabled ? " privacyModeToggleLabelActive" : "")
          }
        >
          プライバシーモード
        </span>
        <div className="privacyModeHelpWrap">
          <button
            type="button"
            className={
              "privacyModeHelpBtn" +
              (enabled ? " privacyModeHelpBtnActive" : "")
            }
            aria-label="プライバシーモードの説明"
            aria-describedby={tooltipId}
          >
            ?
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className="privacyModeHelpTooltip"
          >
            ユーザーがプライバシーモードをONにするとapi_idが1と2の操作が保留され、できなくなります。ユーザーがプライバシーモードをOFFにすると保留されていた操作がされます。
          </span>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        onClick={() => onEnabledChange(!enabled)}
        className={
          "privacyModeSwitch" + (enabled ? " privacyModeSwitchOn" : "")
        }
      >
        <span className="privacyModeSwitchThumb" aria-hidden />
      </button>
    </div>
  );
}
