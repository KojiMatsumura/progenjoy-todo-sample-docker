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
            オンにするとデータはどこにも送信されず、ページから移動するとプログラムに入力した内容が消えます。
            <br />
            オフにするとデータが当サイトのサーバーに送信される場合があり、その場合はプログラムに入力した内容を次回利用時に引き継げます。
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
