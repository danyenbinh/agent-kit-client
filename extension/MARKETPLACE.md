# Publish Agent Kit for Unity + kiếm tiền

## Quan trọng (đọc trước)

| Nơi | Là gì | Kiếm tiền thế nào |
|-----|--------|-------------------|
| **Visual Studio Marketplace** (marketplace.visualstudio.com) cho **VS Code / Cursor** | Kho extension giống ảnh Extensions | Listing **miễn phí**. Microsoft **không** chia tiền theo Install như App Store. |
| **Visual Studio 2022** (IDE .NET, VSIX khác) | Marketplace khác, project C# | **Không** dùng cho Agent Kit MCP hiện tại. |
| **Portal Agent Kit** (`/pay`, Stripe) | Account + license + pack zip | **Đây mới là chỗ thu tiền** Unity Pro / Studio. |

Mô hình đúng: **extension free trên Marketplace** → user Apply Core → **Upgrade Pro trên portal của bạn**.

Không kỳ vọng “bán extension trả phí trên VS Marketplace” như Unity Asset Store — kênh đó gần như không phù hợp SaaS pack+license.

---

## Suspicious content / marketplace rejection

If Marketplace says **suspicious content**:

1. Publish **0.1.1+** (metadata cleaned; `MARKETPLACE.md` not inside VSIX).  
2. Ensure GitHub repo `agent-kit-client` is **public** and matches `repository.url`.  
3. Publisher **ZezoCode** verified / same account as PAT.  
4. Do not keyword-stuff; keep description factual.  
5. If still blocked: https://aka.ms/vsmarketplace-support (attach publisher + extension id `ZezoCode.agent-kit-for-unity`).

---

## A. Chuẩn bị publisher (một lần)

1. Tài khoản Microsoft + tạo publisher:  
   https://marketplace.visualstudio.com/manage  
2. Publisher id phải khớp `publisher` trong `package.json` (hiện tại: **`ZezoCode`**).  
3. Personal Access Token (Azure DevOps):  
   - https://dev.azure.com → User settings → Personal access tokens  
   - Scope: **Marketplace → Manage**  
4. Login máy build (Node **20+**):

```powershell
cd agent-kit-client/extension
npm run sync-vendor
cd vendor/mcp/agent-kit-client ; npm install --omit=dev ; cd ../../..
npm run ensure-icon
npx --yes @vscode/vsce login <publisher-id>
```

Dán PAT khi được hỏi.

---

## B. Đóng gói & đẩy lên Marketplace

```powershell
cd agent-kit-client/extension
npm run package
# → agent-kit-for-unity-0.1.0.vsix

npx --yes @vscode/vsce publish
# hoặc: npx @vscode/vsce publish -i .\agent-kit-for-unity-0.1.0.vsix
```

Checklist trước publish:

- [ ] `displayName` = **Agent Kit for Unity**
- [ ] README rõ: Core free; Pro = portal
- [ ] `icon.png` 128×128
- [ ] `repository` / `homepage` đúng
- [ ] License API production trong docs (không chỉ localhost)
- [ ] Không ship `kit-dev`, Unity Runtime, PKE trong VSIX free

Sau khi duyệt, search **“Agent Kit for Unity”** trên VS Code / Cursor Extensions.

**Cursor:** thường cài được extension từ VS Marketplace; nếu Cursor chỉ Open VSX, thêm publish Open VSX (tùy chọn): https://open-vsx.org/

---

## C. Kiếm tiền (recommended)

```text
Marketplace Install (free)
    → Apply Core
    → Open Pricing / Portal
    → Stripe Checkout (Unity Pro / Studio)
    → License key + Apply packs Pro
```

Việc cần làm ops:

1. Host `agent-kit-cloud/services/license` public HTTPS (`AGENT_KIT_PUBLIC_BASE`).  
2. Stripe **live** + Google OAuth (xem `ops/PAYMENT.md`).  
3. Trong extension settings mặc định `agentKit.licenseApi` = URL production (sau khi ổn định).  
4. Listing Marketplace: nút / copy “Buy Unity Pro” → portal.

**Không** nhồi Pro packs vào VSIX free — giữ SKU.

---

## D. Không làm

- Đăng lên **Visual Studio 2022** marketplace như VSIX C# (sai stack).  
- Đặt giá trả phí trên VS Marketplace rồi kỳ vọng Microsoft thu hộ (phức tạp / không phù hợp pack SaaS).  
- Dùng tên chung “Agent Kit” không có “Unity” (dễ chìm cạnh Google/Salesforce).

---

## E. Sau mỗi release

1. Bump `version` trong `extension/package.json`  
2. `npm run package` + `vsce publish`  
3. Tag git trên `agent-kit-client`  
4. Rebuild `dist` packs trên cloud nếu Pro đổi version  

Publisher manage: https://marketplace.visualstudio.com/manage/publishers/
