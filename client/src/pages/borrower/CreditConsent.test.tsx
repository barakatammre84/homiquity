import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, loanApplicationKeys } from "@/lib/queryClient";

// Preserve the existing disclosure, visible inquiry explanation and fresh acknowledgment.

const apiRequest = vi.fn();
const toast = vi.fn();

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("wouter", () => ({
  useParams: () => ({ id: "app-1" }),
  useLocation: () => ["/credit-consent/app-1", vi.fn()],
}));

import CreditConsent from "./CreditConsent";

function renderPage({
  disclosureText,
  draft = null,
}: {
  disclosureText: string;
  /** A previously saved draft, as the server would return it. */
  draft?: Record<string, unknown> | null;
}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Everything the page reads is seeded below; Infinity keeps the seeds
        // authoritative and the stub queryFn makes any unseeded read hang
        // loudly instead of silently resolving.
        staleTime: Infinity,
        queryFn: () => new Promise(() => {}),
      },
    },
  });
  client.setQueryData(loanApplicationKeys.detail("app-1"), {
    id: "app-1",
    status: "documents_pending",
  });
  client.setQueryData(["/api/credit/disclosure"], {
    disclosureText,
    disclosureVersion: "FCRA-2025-v2",
  });
  client.setQueryData(loanApplicationKeys.credit.summary("app-1"), {
    hasActiveConsent: false,
    consent: null,
    latestPull: null,
    pullCount: 0,
    adverseActionCount: 0,
  });
  client.setQueryData(loanApplicationKeys.credit.draft("app-1"), { draft });
  return render(
    <QueryClientProvider client={client}>
      <CreditConsent />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  toast.mockReset();
});

describe("ux-20 — the hard-inquiry fact is visible at the ask, not only inside the scrolled document", () => {
  it("shows a hard-inquiry callout at the authorization step even when the disclosure document is empty", () => {
    renderPage({ disclosureText: "" });

    const callout = screen.getByTestId("alert-hard-inquiry");
    expect(callout.textContent).toMatch(/hard credit inquiry/i);
    expect(callout.textContent).toMatch(/may temporarily lower your credit score/i);
  });

  it("names the hard inquiry in the authorization checkbox label itself", () => {
    renderPage({ disclosureText: "" });

    const label = screen.getByTestId("label-acknowledge");
    expect(label.textContent).toMatch(/hard credit inquiry/i);
    expect(label.textContent).toMatch(/may temporarily lower my credit score/i);
  });

  it("names the hard inquiry in the fine print under the authorize button", () => {
    renderPage({ disclosureText: "" });

    const finePrint = screen.getByTestId("text-authorize-fine-print");
    expect(finePrint.textContent).toMatch(/hard credit inquiry/i);
    expect(finePrint.textContent).toMatch(/120 days/);
  });

  it("keeps the disclosure document itself rendered from the server text, unchanged", () => {
    renderPage({
      disclosureText: "CONSUMER CREDIT AUTHORIZATION AND DISCLOSURE\n2. CREDIT INQUIRY TYPE: ...",
    });

    expect(screen.getByTestId("text-disclosure-content").textContent).toContain(
      "CONSUMER CREDIT AUTHORIZATION AND DISCLOSURE",
    );
  });

  it("still gates the authorize button on name + acknowledgment", () => {
    renderPage({ disclosureText: "" });

    // No jest-dom in the client lane (house convention — see Lenders.test.tsx).
    const button = screen.getByTestId("button-authorize-credit") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("a saved draft never pre-ticks the FCRA authorization", () => {
  // A stored draft must not restore the live authorization checkbox.

  const SAVED_DRAFT = {
    borrowerFullName: "Alex Rivera",
    borrowerSSNLast4: "1234",
    borrowerDOB: "1990-04-01",
    disclosureRead: true,
    acknowledged: true,
    currentStep: 3,
  };

  it("renders the acknowledgment UNCHECKED even when the draft saved it as true", () => {
    renderPage({ disclosureText: "", draft: SAVED_DRAFT });

    expect(screen.getByTestId("checkbox-acknowledge").getAttribute("data-state")).toBe(
      "unchecked",
    );
  });

  it("keeps the authorize button disabled until the borrower re-acknowledges", () => {
    renderPage({ disclosureText: "", draft: SAVED_DRAFT });

    const button = screen.getByTestId("button-authorize-credit") as HTMLButtonElement;
    // The name IS restored, so the only thing still holding the gate shut is
    // the acknowledgment — which is exactly the point.
    expect((screen.getByTestId("input-full-name") as HTMLInputElement).value).toBe(
      "Alex Rivera",
    );
    expect(button.disabled).toBe(true);
  });

  it("re-acknowledging in this session opens the gate", async () => {
    const user = userEvent.setup();
    renderPage({ disclosureText: "", draft: SAVED_DRAFT });

    await user.click(screen.getByTestId("checkbox-acknowledge"));

    expect(screen.getByTestId("checkbox-acknowledge").getAttribute("data-state")).toBe(
      "checked",
    );
    expect((screen.getByTestId("button-authorize-credit") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("still restores the identity fields the draft exists to save", () => {
    renderPage({ disclosureText: "", draft: SAVED_DRAFT });

    expect((screen.getByTestId("input-ssn-last4") as HTMLInputElement).value).toBe("1234");
    expect((screen.getByTestId("input-dob") as HTMLInputElement).value).toBe("1990-04-01");
  });
});

describe("the authorization copy survives the ConsentField migration byte-for-byte", () => {
  it("renders the existing authorization sentence exactly", () => {
    renderPage({ disclosureText: "" });

    // The retry repair leaves the authorization text unchanged.
    expect(screen.getByTestId("label-acknowledge").textContent).toBe(
      "I have read and understand the Credit Authorization Disclosure above. I authorize " +
        "Homiquity to obtain my credit report from one or more consumer reporting agencies " +
        "for the purpose of evaluating my mortgage loan application. I understand this " +
        "permits a hard credit inquiry, which may temporarily lower my credit score.",
    );
  });

  it("declining costs nothing, and says so", () => {
    renderPage({ disclosureText: "" });

    const note = screen.getByTestId("text-consent-optional").textContent!;
    expect(note).toMatch(/nothing is submitted until you\s+authorize/);
    expect(note).not.toMatch(/must|required to|will not be able/i);
  });
});

describe("credit consent requests remain usable after failure", () => {
  async function fillAuthorization() {
    const user = userEvent.setup();
    renderPage({ disclosureText: "Synthetic disclosure for this test" });
    await user.type(screen.getByTestId("input-full-name"), "Alex Rivera");
    await user.click(screen.getByTestId("checkbox-acknowledge"));
    return user;
  }

  for (const action of [
    { button: "button-authorize-credit", endpoint: "consent", success: "Consent Recorded" },
    { button: "button-save-progress", endpoint: "draft", success: "Progress Saved" },
  ]) {
    it.each([
      ["server failure", new ApiError(500, '500: {"error":"internal connection detail"}')],
      ["forbidden response", new ApiError(403, '403: {"error":"Access denied"}')],
      ["network failure", new TypeError("Failed to fetch")],
    ])(`releases ${action.endpoint} after %s and permits an explicit retry`, async (_label, error) => {
      let rejectRequest!: (error: Error) => void;
      apiRequest.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
      apiRequest.mockResolvedValue({ json: async () => ({}) });
      const user = await fillAuthorization();
      const button = screen.getByTestId(action.button) as HTMLButtonElement;

      await user.click(button);
      await waitFor(() => expect(button.disabled).toBe(true));
      await user.click(button);
      expect(apiRequest).toHaveBeenCalledTimes(1);

      await act(async () => { rejectRequest(error); });
      await waitFor(() => expect(button.disabled).toBe(false));
      expect((screen.getByTestId("input-full-name") as HTMLInputElement).value).toBe("Alex Rivera");
      expect(screen.getByTestId("checkbox-acknowledge").getAttribute("data-state")).toBe("checked");
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
      expect(toast.mock.calls[0][0].description).not.toMatch(/500:|403:|internal connection|\{"error"/);

      await user.click(button);
      await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: action.success })));
      expect(apiRequest).toHaveBeenCalledTimes(2);
      expect(apiRequest.mock.calls[1][1]).toBe(`/api/loan-applications/app-1/credit/${action.endpoint}`);
      await waitFor(() => expect(button.disabled).toBe(false));
    });
  }

  it("omits blank optional SSN digits while retaining the affirmative consent payload", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({}) });
    const user = await fillAuthorization();
    await user.click(screen.getByTestId("button-authorize-credit"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const body = JSON.parse(JSON.stringify(apiRequest.mock.calls[0][2]));
    expect(body).not.toHaveProperty("borrowerSSNLast4");
    expect(body).toMatchObject({ consentType: "hard_pull", borrowerFullName: "Alex Rivera", consentGiven: true });
  });

  it("keeps valid last-four digits unchanged, including leading zeros", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({}) });
    const user = await fillAuthorization();
    await user.type(screen.getByTestId("input-ssn-last4"), "0012");
    await user.click(screen.getByTestId("button-authorize-credit"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest.mock.calls[0][2]).toMatchObject({ borrowerSSNLast4: "0012", consentGiven: true });
  });

  it("lets the borrower correct partial SSN digits before sending an authorization", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({}) });
    const user = await fillAuthorization();
    await user.type(screen.getByTestId("input-ssn-last4"), "12");
    await user.click(screen.getByTestId("button-authorize-credit"));
    expect(apiRequest).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Enter exactly four SSN digits, or leave this optional field blank.",
      variant: "destructive",
    }));
    await user.clear(screen.getByTestId("input-ssn-last4"));
    await user.click(screen.getByTestId("button-authorize-credit"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
  });

  it("can save incomplete identity fields as a draft without providing consent", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({}) });
    const user = userEvent.setup();
    renderPage({ disclosureText: "Synthetic disclosure for this test" });
    await user.type(screen.getByTestId("input-ssn-last4"), "12");
    await user.click(screen.getByTestId("button-save-progress"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest.mock.calls[0][1]).toBe("/api/loan-applications/app-1/credit/draft");
    expect(apiRequest.mock.calls[0][2]).toMatchObject({ borrowerSSNLast4: "12", acknowledged: false });
    expect(apiRequest.mock.calls[0][2]).not.toHaveProperty("consentGiven");
  });
});
