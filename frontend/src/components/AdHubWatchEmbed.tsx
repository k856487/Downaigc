import React from "react";
import { App, Button, Space, Spin, Typography } from "antd";
import * as QRCode from "qrcode";
import { adhubWatchUrl, getAdhubQrCode } from "../api/adhubClient";

type AdHubWatchEmbedProps = {
  /** 不传则使用 VITE_ADHUB_QR_CODE 或默认 1zbovxyaowp */
  code?: string;
  /** 是否显示内嵌 iframe 预览 */
  showIframe?: boolean;
  iframeHeight?: number;
};

const AdHubWatchEmbed: React.FC<AdHubWatchEmbedProps> = ({
  code,
  showIframe = false,
  iframeHeight = 480
}) => {
  const { message } = App.useApp();
  const qrCode = (code || getAdhubQrCode()).trim();
  const watchUrl = adhubWatchUrl(qrCode);
  const [qrDataUrl, setQrDataUrl] = React.useState("");
  const [loadingQr, setLoadingQr] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoadingQr(true);
    QRCode.toDataURL(watchUrl, { width: 200, margin: 2 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      })
      .finally(() => {
        if (!cancelled) setLoadingQr(false);
      });
    return () => {
      cancelled = true;
    };
  }, [watchUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(watchUrl);
      message.success("链接已复制");
    } catch {
      message.info(watchUrl);
    }
  };

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        专属码 <Typography.Text code>{qrCode}</Typography.Text>：请用<strong>微信扫一扫</strong>下方二维码，在<strong>手机</strong>上观看广告（本页只展示推广码，不在电脑里播放）。
        {watchUrl.includes("127.0.0.1") ? (
          <Typography.Text type="danger"> 当前链接仍是 localhost，手机无法打开，请改 .env 中 VITE_ADHUB_WATCH_BASE 为本机局域网 IP 后重启前端。</Typography.Text>
        ) : (
          <Typography.Text type="secondary"> 手机需与电脑同一 WiFi。</Typography.Text>
        )}
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: watchUrl }} style={{ marginBottom: 0, wordBreak: "break-all" }}>
        {watchUrl}
      </Typography.Paragraph>
      <Space wrap align="start">
        {loadingQr ? (
          <Spin />
        ) : qrDataUrl ? (
          <img src={qrDataUrl} alt="扫码观看广告" width={200} height={200} className="adhub-watch-embed__qr" />
        ) : null}
        <Space direction="vertical" size={4}>
          <Button onClick={() => void copyLink()}>复制手机观看链接</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            联调可在电脑浏览器打开
            <Button type="link" size="small" href={watchUrl} target="_blank" rel="noreferrer" style={{ padding: 0, height: "auto" }}>
              观看页
            </Button>
          </Typography.Text>
        </Space>
      </Space>
      {showIframe ? (
        <iframe
          title="adhub-watch"
          src={watchUrl}
          className="adhub-watch-embed__frame"
          style={{ width: "100%", height: iframeHeight, border: "1px solid #eee", borderRadius: 8 }}
        />
      ) : null}
    </Space>
  );
};

export default AdHubWatchEmbed;
