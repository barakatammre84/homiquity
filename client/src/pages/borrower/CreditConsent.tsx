import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, loanApplicationKeys } from "@/lib/queryClient";
import { friendlyApiError } from "@/lib/errorMessage";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConsentField } from "@/components/patterns/ConsentField";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import {
  Shield,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  CreditCard,
  Lock,
  Info,
  ChevronRight,
  Save,
  RefreshCw,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { QueryErrorState } from "@/components/ui/query-boundary";
import type { LoanApplication, DraftConsentProgress } from "@shared/schema";

interface DisclosureData {
  disclosureText: string;
  disclosureVersion: string;
}

interface ConsentData {
  consent: {
    id: string;
    applicationId: string;
    userId: string;
    consentType: string;
    disclosureVersion: string;
    consentGiven: boolean;
    consentTimestamp: string;
    borrowerFullName: string;
    isActive: boolean;
  } | null;
}

interface CreditSummary {
  hasActiveConsent: boolean;
  consent: ConsentData["consent"];
  latestPull: {
    id: string;
    status: string;
    representativeScore: number | null;
    experianScore: number | null;
    equifaxScore: number | null;
    transunionScore: number | null;
    completedAt: string | null;
    expiresAt: string | null;
  } | null;
  pullCount: number;
  adverseActionCount: number;
}

interface DraftData {
  draft: DraftConsentProgress | null;
}

export default function CreditConsent() {
  const queryClient = useQueryClient();
  const { id: applicationId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [fullName, setFullName] = useState("");
  const [ssnLast4, setSsnLast4] = useState("");
  const [dob, setDob] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [disclosureRead, setDisclosureRead] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const {
    data: application,
    isLoading: appLoading,
    isError: appError,
    error: appErrorObj,
    refetch: refetchApp,
  } = useQuery<LoanApplication>({
    queryKey: loanApplicationKeys.detail(applicationId),
    enabled: !!applicationId,
  });

  const {
    data: disclosure,
    isLoading: disclosureLoading,
    isError: disclosureError,
    error: disclosureErrorObj,
    refetch: refetchDisclosure,
  } = useQuery<DisclosureData>({
    queryKey: ["/api/credit/disclosure"],
    enabled: !!applicationId,
  });

  const { data: creditSummary, isLoading: summaryLoading } = useQuery<CreditSummary>({
    queryKey: loanApplicationKeys.credit.summary(applicationId),
    enabled: !!applicationId,
  });

  const { data: draftData, isLoading: draftLoading } = useQuery<DraftData>({
    queryKey: loanApplicationKeys.credit.draft(applicationId),
    enabled: !!applicationId,
  });

  // Restore draft identity fields, but keep the live acknowledgment unchecked.
  // Returning borrowers must acknowledge again before submitting authorization.
  useEffect(() => {
    if (draftData?.draft && !draftLoaded) {
      const draft = draftData.draft;
      if (draft.borrowerFullName) setFullName(draft.borrowerFullName);
      if (draft.borrowerSSNLast4) setSsnLast4(draft.borrowerSSNLast4);
      if (draft.borrowerDOB) setDob(draft.borrowerDOB);
      if (draft.disclosureRead) setDisclosureRead(draft.disclosureRead);
      setDraftLoaded(true);
    }
  }, [draftData, draftLoaded]);

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/loan-applications/${applicationId}/credit/draft`, {
        borrowerFullName: fullName,
        borrowerSSNLast4: ssnLast4,
        borrowerDOB: dob,
        disclosureRead,
        acknowledged,
        currentStep: acknowledged ? 3 : disclosureRead ? 2 : 1,
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loanApplicationKeys.credit.draft(applicationId) });
      toast({
        title: "Progress Saved",
        description: "Your consent form progress has been saved. You can return anytime to complete it.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: friendlyApiError(error, "We couldn't save your progress. Please try again."),
        variant: "destructive",
      });
    },
  });

  const saving = saveDraftMutation.isPending;
  const handleSaveDraft = () => saveDraftMutation.mutate();

  const submitConsentMutation = useMutation({
    mutationFn: async (consentGiven: boolean) => {
      const response = await apiRequest("POST", `/api/loan-applications/${applicationId}/credit/consent`, {
        consentType: "hard_pull",
        borrowerFullName: fullName,
        borrowerSSNLast4: ssnLast4 || undefined,
        borrowerDOB: dob,
        consentGiven,
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loanApplicationKeys.credit.root(applicationId) });
      toast({
        title: "Consent Recorded",
        description: "Your credit authorization has been recorded successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: friendlyApiError(error, "We couldn't record your authorization. Please try again."),
        variant: "destructive",
      });
    },
  });

  const submitting = submitConsentMutation.isPending;
  const handleSubmitConsent = () => {
    if (!fullName.trim()) {
      toast({
        title: "Required Field",
        description: "Please enter your full legal name",
        variant: "destructive",
      });
      return;
    }

    if (!acknowledged) {
      toast({
        title: "Acknowledgment Required",
        description: "Please acknowledge that you have read and understood the disclosure",
        variant: "destructive",
      });
      return;
    }

    if (ssnLast4 && !/^\d{4}$/.test(ssnLast4)) {
      toast({
        title: "Check SSN Digits",
        description: "Enter exactly four SSN digits, or leave this optional field blank.",
        variant: "destructive",
      });
      return;
    }

    submitConsentMutation.mutate(true);
  };

  const isLoading = appLoading || disclosureLoading || summaryLoading || draftLoading;

  if (isLoading) {
    return (
      <PageShell width="content" contentClassName="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </PageShell>
    );
  }

  // A fetch failure on `application` used to be indistinguishable from a
  // genuine 404 below — right at a page that authorizes a credit pull, that's
  // the worst place to tell a borrower their file vanished when the real
  // problem is a transient network error (ux-10).
  if (appError || disclosureError) {
    return (
      <PageShell width="content">
        <QueryErrorState
          error={appErrorObj ?? disclosureErrorObj}
          onRetry={() => {
            if (appError) refetchApp();
            if (disclosureError) refetchDisclosure();
          }}
          title="We couldn't load this page"
          data-testid="credit-consent-error"
        />
      </PageShell>
    );
  }

  if (!application) {
    return (
      <PageShell width="content">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Application Not Found</h2>
            <p className="text-muted-foreground">The loan application could not be found.</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const hasActiveConsent = creditSummary?.hasActiveConsent;
  const consent = creditSummary?.consent;
  const latestPull = creditSummary?.latestPull;

  return (
    <PageShell
      width="content"
      icon={<Shield className="h-8 w-8 text-primary" />}
      title="Credit Authorization"
      subtitle="FCRA-compliant credit disclosure and consent"
      titleTestId="text-credit-auth-title"
      contentClassName="space-y-6"
    >
      {hasActiveConsent && (
        <Card className="border-border bg-success-subtle">
          <CardContent className="py-6">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-success-subtle-foreground mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-success-subtle-foreground" data-testid="text-consent-active">
                  Consent Already Provided
                </h3>
                <p className="text-sm text-success-subtle-foreground mt-1">
                  {consent?.borrowerFullName} authorized a credit check on{" "}
                  {consent?.consentTimestamp && format(new Date(consent.consentTimestamp), "MMMM d, yyyy 'at' h:mm a")}
                </p>
                {latestPull && (
                  <div className="mt-4 p-4 bg-card rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard className="h-4 w-4" />
                      <span className="font-medium">Credit Report Summary</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Representative</span>
                        <p className="text-xl font-bold" data-testid="text-credit-score-representative">
                          {latestPull.representativeScore || "—"}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Experian</span>
                        <p className="font-semibold" data-testid="text-credit-score-experian">{latestPull.experianScore || "—"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Equifax</span>
                        <p className="font-semibold" data-testid="text-credit-score-equifax">{latestPull.equifaxScore || "—"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">TransUnion</span>
                        <p className="font-semibold" data-testid="text-credit-score-transunion">{latestPull.transunionScore || "—"}</p>
                      </div>
                    </div>
                    {latestPull.expiresAt && (
                      <p className="text-xs text-muted-foreground mt-3">
                        Valid until {format(new Date(latestPull.expiresAt), "MMMM d, yyyy")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!hasActiveConsent && (
        <>
          {draftData?.draft && (
            <Alert className="border-border bg-info-subtle">
              <RefreshCw className="h-4 w-4 text-info" />
              <AlertDescription className="text-info">
                <strong>Resume Progress:</strong> You have a saved draft from{" "}
                {draftData.draft.lastSavedAt && formatDistanceToNow(new Date(draftData.draft.lastSavedAt), { addSuffix: true })}.
                Your progress has been restored automatically.
                {draftData.draft.expiresAt && (
                  <span className="block text-sm mt-1 opacity-80">
                    This draft expires {format(new Date(draftData.draft.expiresAt), "MMMM d, yyyy")}
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Credit Authorization Disclosure
              </CardTitle>
              <CardDescription>
                Please read the following disclosure carefully before providing your authorization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                <span>Version: {disclosure?.disclosureVersion}</span>
              </div>
              
              <ScrollArea className="h-64 rounded-md border p-4 bg-muted/30">
                <pre className="whitespace-pre-wrap text-sm font-sans" data-testid="text-disclosure-content">
                  {disclosure?.disclosureText}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Your Authorization
              </CardTitle>
              <CardDescription>
                Provide your information to authorize the credit check
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="fullName">Full Legal Name *</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full legal name as it appears on your ID"
                    data-testid="input-full-name"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="ssnLast4">Last 4 of SSN (optional)</Label>
                  <Input
                    id="ssnLast4"
                    value={ssnLast4}
                    onChange={(e) => setSsnLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="1234"
                    maxLength={4}
                    data-testid="input-ssn-last4"
                  />
                  <p className="text-xs text-muted-foreground" data-testid="text-ssn-whisper">
                    Used only to match you with your credit report — we never ask for your full
                    SSN here, and sharing it is optional.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="dob">Date of Birth (optional)</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    data-testid="input-dob"
                  />
                </div>
              </div>

              <Separator />

              {/* Keep the existing inquiry explanation beside the authorization control. */}
              <Alert data-testid="alert-hard-inquiry">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>This authorizes a hard credit inquiry</strong> — unlike the soft check
                  used for pre-qualification, a hard inquiry may temporarily lower your credit
                  score. Mortgage inquiries made within a 45-day period are typically counted as
                  a single inquiry for scoring purposes.
                </AlertDescription>
              </Alert>

              {/* Preserve the existing authorization text in the checkbox label. */}
              <ConsentField
                id="acknowledge"
                checked={acknowledged}
                onCheckedChange={setAcknowledged}
                data-testid="consent-acknowledge"
                checkboxTestId="checkbox-acknowledge"
                labelTestId="label-acknowledge"
                label="I have read and understand the Credit Authorization Disclosure above. I authorize Homiquity to obtain my credit report from one or more consumer reporting agencies for the purpose of evaluating my mortgage loan application. I understand this permits a hard credit inquiry, which may temporarily lower my credit score."
              />

              {/* Explain the existing option to save progress and return later. */}
              <p className="text-sm text-muted-foreground" data-testid="text-consent-optional">
                You can leave this for later — nothing is submitted until you
                authorize, and your saved progress will be here when you return.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleSubmitConsent}
                  disabled={!fullName || !acknowledged || submitting}
                  className="flex-1"
                  data-testid="button-authorize-credit"
                >
                  {submitting ? (
                    <>
                      <Clock className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4 mr-2" />
                      I Authorize Credit Check
                    </>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  data-testid="button-save-progress"
                >
                  {saving ? (
                    <>
                      <Clock className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Progress
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setLocation("/dashboard")}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center" data-testid="text-authorize-fine-print">
                By clicking "I Authorize", you are providing written authorization for a hard credit
                inquiry as required by the Fair Credit Reporting Act (FCRA). This authorization is
                valid for 120 days.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your Rights Under the FCRA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <ChevronRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p>You have the right to obtain a free credit report annually from each bureau at annualcreditreport.com</p>
          </div>
          <div className="flex items-start gap-3">
            <ChevronRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p>You have the right to dispute any inaccurate information on your credit report</p>
          </div>
          <div className="flex items-start gap-3">
            <ChevronRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p>If we take adverse action based on your credit, you will receive a notice explaining why</p>
          </div>
          <div className="flex items-start gap-3">
            <ChevronRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p>Multiple mortgage inquiries within 45 days count as a single inquiry for scoring purposes</p>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
