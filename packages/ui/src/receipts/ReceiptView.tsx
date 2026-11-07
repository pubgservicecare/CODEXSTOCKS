import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { whatsappDigits, type PaymentReceiptData, type PlanReceiptData, type Receipt } from "@codex/shared";
import { errMsg, Modal, Notice, useApp } from "../components";
import { Icon } from "../icons";
import type { RenderedReceipt } from "./render";

function parse(r: Receipt): PlanReceiptData | PaymentReceiptData | null {
  try {
    return JSON.parse(r.data_json) as PlanReceiptData | PaymentReceiptData;
  } catch {
    return null;
  }
}

/** Plain text that goes with the image (WhatsApp cannot be given an image through a link). */
export function receiptMessage(d: PlanReceiptData | PaymentReceiptData): string {
  if (d.kind === "plan")
    return `${d.business.business_name}\nPayment plan ${d.receipt_no} for ${d.account.title}.\nI'm sending the plan as an image (PNG).`;
  return `${d.business.business_name}\nPayment received — receipt ${d.receipt_no} for ${d.account.title}.\nI'm sending the receipt as an image (PNG).`;
}

/**
 * Shows an issued receipt as a PNG drawn from its stored snapshot, with Download, Share (only where the
 * device can share files), WhatsApp and Print. A receipt is never edited; a reversed payment's receipt is
 * shown with a REVERSED stamp.
 */
export function ReceiptView({ receipt, reversed, onClose }: { receipt: Receipt; reversed?: boolean; onClose: () => void }) {
  const { svc, toast } = useApp();
  const data = parse(receipt);
  const [img, setImg] = useState<RenderedReceipt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const fileName = `${receipt.receipt_no}.png`;

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    if (!data) {
      setErr("This receipt could not be read.");
      return;
    }
    import("./render")
      .then(({ renderReceiptPng }) => renderReceiptPng(data, { reversed }))
      .then((r) => {
        url = r.url;
        if (live) setImg(r);
        else URL.revokeObjectURL(r.url);
      })
      .catch((e) => live && setErr(errMsg(e)));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.id, reversed]);

  const file = img ? new File([img.blob], fileName, { type: "image/png" }) : null;
  const canShareFile = !!(file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }));

  const download = async () => {
    if (!img) return;
    try {
      if (svc.savePng) {
        const ok = await svc.savePng(fileName, img.bytes);
        if (ok) toast(svc.kind === "desktop" ? "Receipt image saved" : "Receipt image downloaded");
      } else {
        const a = document.createElement("a");
        a.href = img.url;
        a.download = fileName;
        a.click();
      }
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  };

  const share = async () => {
    if (!file || !data) return;
    try {
      await navigator.share({ files: [file], title: receipt.receipt_no, text: receiptMessage(data) });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast(errMsg(e), "bad");
    }
  };

  const whatsapp = () => {
    if (!data) return;
    const to = whatsappDigits(data.customer.whatsapp ?? data.customer.phone);
    const url = `https://wa.me/${to ?? ""}?text=${encodeURIComponent(receiptMessage(data))}`;
    if (svc.openExternal) void svc.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const print = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrinting(false), 500);
    }, 80);
  };

  return (
    <Modal title={data?.kind === "plan" ? "Payment plan" : "Payment received"} icon="receipt" onClose={onClose} wide>
      <div className="receipt-head small muted">
        <span><b>{receipt.receipt_no}</b> · issued {new Date(receipt.issued_at).toLocaleString()}</span>
        {reversed && <span className="badge bad">Payment reversed</span>}
      </div>
      {err && <Notice kind="bad">{err}</Notice>}
      <div className="receipt-preview" aria-busy={!img && !err}>
        {img ? <img src={img.url} alt={`Receipt ${receipt.receipt_no}`} width={img.width / 2} height={img.height / 2} /> : !err && <div className="skeleton"><div className="sk" style={{ height: 420 }} /></div>}
      </div>
      <div className="modal-actions receipt-actions">
        <button className="btn primary" onClick={() => void download()} disabled={!img}>
          <Icon name="download" size={15} /> Download PNG
        </button>
        {canShareFile && (
          <button className="btn" onClick={() => void share()}>
            <Icon name="share" size={15} /> Share image
          </button>
        )}
        <button className="btn" onClick={whatsapp} disabled={!data}>
          <Icon name="message" size={15} /> WhatsApp
        </button>
        <button className="btn ghost" onClick={print} disabled={!img}>
          <Icon name="printer" size={15} /> Print
        </button>
      </div>
      <p className="small faint receipt-note">
        {canShareFile
          ? "Share image sends the PNG through your device's share menu (WhatsApp included). "
          : "This device cannot share image files directly. "}
        The WhatsApp button opens a chat with a short message only — WhatsApp links cannot carry an image, so download the PNG and attach it in the chat.
      </p>
      {printing && img && createPortal(<div className="receipt-print"><img src={img.url} alt="" /></div>, document.body)}
    </Modal>
  );
}
