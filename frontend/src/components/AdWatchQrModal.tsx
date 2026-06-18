import React from "react";
import { App, Modal, Spin, Typography, Button, Space } from "antd";
import * as QRCode from "qrcode";
import { adhubWatchUrl, getAdhubQrCode } from "../api/adhubClient";

type AdWatchQrModalProps = {
  open: boolean;
  onClose: () => void;
};

const AdWatchQrModal: React.FC<AdWatchQrModalProps> = ({ open, onClose }) => {
  const { message } = App.useApp();
  const qrCode = getAdhubQrCode();
  const watchUrl = adhubWatchUrl(qrCode);

  const [loading, setLoading] = React.useState(false);
  const [qrDataUrl, setQrDataUrl] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setLoading(false);
      setQrDataUrl("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    QRCode.toDataURL(watchUrl, { width: 220, margin: 2 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, watchUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(watchUrl);
      message.success("链接已复制");
    } catch {
      message.info(watchUrl);
    }
  };

  return (
    <Modal
      open={open}
      title="微信扫码看广告"
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          关闭
        </Button>
      }
      destroyOnClose
      width={400}
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Typography.Paragraph style={{ marginBottom: 0 }} className="ad-watch-qr-modal__hint">
          请用<strong>微信扫一扫</strong>下方二维码，在<strong>手机</strong>上打开广告页并完成观看（约 30 秒）。
          本弹窗仅展示推广码，广告在手机上播放。
          {watchUrl.includes("127.0.0.1") ? (
            <Typography.Text type="danger"> 当前链接为 localhost，手机无法访问，请配置局域网 IP。</Typography.Text>
          ) : (
            <Typography.Text type="secondary"> 手机需与电脑同一 WiFi。</Typography.Text>
          )}
        </Typography.Paragraph>
        {loading ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <Spin tip="正在生成二维码…" />
          </div>
        ) : qrDataUrl ? (
          <div className="ad-watch-qr-modal__qr-wrap">
            <img src={qrDataUrl} alt="微信扫码观看广告" width={220} height={220} />
            <Typography.Text type="secondary" className="ad-watch-qr-modal__status">
              专属码 {qrCode}
            </Typography.Text>
          </div>
        ) : (
          <Typography.Text type="danger">二维码生成失败</Typography.Text>
        )}
        <Typography.Paragraph
          copyable={{ text: watchUrl }}
          type="secondary"
          style={{ marginBottom: 0, fontSize: 12, wordBreak: "break-all" }}
        >
          {watchUrl}
        </Typography.Paragraph>
        <Button block onClick={() => void copyLink()}>
          复制手机观看链接
        </Button>
      </Space>
    </Modal>
  );
};

export default AdWatchQrModal;
