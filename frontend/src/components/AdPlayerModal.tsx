import React from "react";
import { Modal, Space, Typography, Progress, Button, App } from "antd";
import type { AdItem } from "./AdCarousel";
import { useReward } from "../state/RewardContext";

type AdPlayerModalProps = {
  open: boolean;
  ad: AdItem | null;
  onClose: () => void;
};

const TOTAL_SECONDS = 30;
const CLOSE_AFTER_SECONDS = 5;

const AdPlayerModal: React.FC<AdPlayerModalProps> = ({ open, ad, onClose }) => {
  const { message, modal } = App.useApp();
  const { addPoints } = useReward();
  const [secondsLeft, setSecondsLeft] = React.useState(TOTAL_SECONDS);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [completed, setCompleted] = React.useState(false);
  const [paused, setPaused] = React.useState(false);

  const canClose = (() => {
    if (!startedAt) return false;
    return Date.now() - startedAt >= CLOSE_AFTER_SECONDS * 1000;
  })();

  React.useEffect(() => {
    if (!open || !ad) return;
    setSecondsLeft(TOTAL_SECONDS);
    setStartedAt(Date.now());
    setCompleted(false);
    setPaused(false);
  }, [open, ad]);

  React.useEffect(() => {
    if (!open || !ad) return;
    if (completed || paused) return;

    const t = window.setInterval(() => {
      setSecondsLeft((s) => {
        const next = Math.max(0, s - 1);
        if (next === 0) {
          window.clearInterval(t);
          setCompleted(true);
          if (ad.points > 0) {
            addPoints(ad.points);
            message.success(`已获得 ${ad.points} 积分`);
          } else {
            message.success("播放完成");
          }
          onClose();
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(t);
  }, [open, ad, addPoints, completed, paused, message, onClose]);

  const handleRequestClose = () => {
    if (!ad) return;
    if (!canClose) return;
    if (completed) {
      onClose();
      return;
    }

    // 暂停倒计时
    setPaused(true);

    modal.confirm({
      title: "确认关闭广告？",
      content:
        ad.points > 0
          ? "提前关闭将无法获得本次积分奖励。"
          : "提前关闭将返回页面。",
      okText: "关闭",
      cancelText: "继续观看",
      onOk: () => onClose(),
      onCancel: () => setPaused(false)
    });
  };

  const elapsed = TOTAL_SECONDS - secondsLeft;
  const percent = Math.round((elapsed / TOTAL_SECONDS) * 100);
  const closeCountdown = Math.max(0, CLOSE_AFTER_SECONDS - elapsed);

  return (
    <Modal
      open={open}
      onCancel={handleRequestClose}
      title={ad?.title ?? "广告播放"}
      footer={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">
            剩余 {secondsLeft}s · 观看满 {TOTAL_SECONDS}s 结算奖励
          </Typography.Text>
          <Button onClick={handleRequestClose} disabled={!canClose}>
            {canClose ? "关闭广告" : `可关闭倒计时 ${closeCountdown}s`}
          </Button>
        </Space>
      }
      maskClosable={false}
      closable={false}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前暂无广告资源，将展示 30 秒倒计时模拟播放。观看满后发放积分奖励。
        </Typography.Paragraph>
        <Progress percent={percent} showInfo />
        <div
          style={{
            height: 220,
            borderRadius: 12,
            border: "1px dashed #D0D7E2",
            background: "#F7F9FC",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Typography.Text type="secondary">
            广告播放区域（模拟）
          </Typography.Text>
        </div>
      </Space>
    </Modal>
  );
};

export default AdPlayerModal;

