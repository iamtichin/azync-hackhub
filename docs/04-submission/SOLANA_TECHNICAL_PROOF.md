# Bằng chứng kỹ thuật Solana

## Dữ liệu Azync ghi nhận

Azync cấp hai loại compressed NFT riêng trên Solana devnet:

1. **Submission credential (`AHSUB`)** — chứng minh Azync đã nhận một final snapshot bất biến cho địa chỉ nhận.
2. **Winner credential (`AHWIN`)** — chứng minh organizer đã ghi một quyết định winner do con người đưa ra sau deadline và cấp chứng nhận tương ứng.

Hai credential này không chứng minh code của đội đã deploy hoặc project của đội tự thực hiện giao dịch on-chain. Claim của project luôn được giữ thành nguồn evidence riêng.

## Luồng submission

```text
Người tham gia kết nối ví được hỗ trợ
  → frontend đọc địa chỉ public dùng để nhận
  → backend kiểm tra deadline và final payload
  → lưu receipt bất biến cùng canonical metadata hash
  → mint job gửi cNFT qua Bubblegum tree đã cấu hình
  → reconciliation lưu signature, asset, tree, leaf, owner và cluster
  → UI và public verification endpoint hiển thị proof
```

Người tham gia không ký giao dịch mint. Backend authority trả phí và gửi giao dịch; ví chỉ cung cấp public key nhận chứng nhận.

## Kiểm soát độ tin cậy

- Final receipt được commit độc lập với tình trạng provider.
- Trước khi gửi lại, retry kiểm tra signature và chain state hiện có.
- Retry đồng thời dùng chung lease và không thể tạo proof record thứ hai.
- Trạng thái broadcast chưa rõ được reconcile trước khi thử giao dịch khác.
- Owner, metadata hash, cluster, tree và asset derivation được kiểm tra.
- Quyết định winner được lưu trước khi mint winner credential, nên lỗi RPC không thể thay đổi kết quả.

## Bằng chứng E2E live

- Mạng: Solana devnet.
- Trạng thái mint submission: `CONFIRMED`.
- Giao dịch Explorer: [mở giao dịch submission đã xác minh](https://explorer.solana.com/tx/3Y98zr3eL224naYVKLSEyYydWvJPohsYJuo11A87TfNUW1Srv22CsqTecqXjwvLNewnuHbwZpSALdDLe96zrZASo?cluster=devnet).
- Recipient và asset ID được giữ trong final receipt và Submission Ledger.
- Merkle tree health, số dư authority, transaction finality, metadata và public verify response đã pass checkpoint Phase 5 cùng Phase 8.

## Checkpoint winner

Tính năng winner đã pass migration, service, E2E, frontend và kiểm tra UI live. Organizer chưa chọn winner thật. Sau khi con người thực hiện quyết định này, cần ghi:

- đội và project được chọn;
- `AHWIN` asset ID cùng transaction signature;
- recipient và devnet cluster;
- ảnh Explorer;
- kết quả public verification.

## Phạm vi ví hiện tại

- Phantom: đã chạy live.
- Solflare: adapter và đường UI tự động đã được test, nhưng connect, reject, disconnect và account switch ở mức extension còn bị chặn cho đến khi Solflare được cài trong browser.
