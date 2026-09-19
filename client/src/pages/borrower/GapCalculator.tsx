import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PresalesDisclaimer } from "@/components/PresalesDisclaimer";
import { PageShell } from "@/components/PageShell";
import { QueryErrorState } from "@/components/ui/query-boundary";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import {
  GapGoalOnboardingForm,
  goalFormSchema,
  type GoalFormInput,
  type GoalFormValues,
} from "./GapGoalOnboardingForm";
import { apiRequest, homeownershipGoalKeys } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { HomeownershipGoal, CreditAction, SavingsTransaction, JourneyMilestone } from "@shared/schema";
import type { CreditRecommendation, GapAnalysis } from "./gapCalculator/types";
import { StatsCards } from "./gapCalculator/StatsCards";
import { CreditCoachTab } from "./gapCalculator/CreditCoachTab";
import { SavingsVaultTab } from "./gapCalculator/SavingsVaultTab";
import { RoadmapTab } from "./gapCalculator/RoadmapTab";
import { MilestonesTab } from "./gapCalculator/MilestonesTab";
import { ApplyCtaCard } from "./gapCalculator/ApplyCtaCard";

export default function GapCalculator() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showOnboarding, setShowOnboarding] = useState(false);

  const {
    data: goalData,
    isLoading: goalLoading,
    isError: goalIsError,
    error: goalErrorObj,
    refetch: refetchGoal,
  } = useQuery<{
    goal: HomeownershipGoal | null;
    creditActions: CreditAction[];
    savingsTransactions: SavingsTransaction[];
    milestones: JourneyMilestone[];
  }>({
    queryKey: homeownershipGoalKeys.all(),
  });

  const { data: gapAnalysis } = useQuery<GapAnalysis>({
    queryKey: homeownershipGoalKeys.gapAnalysis(),
    enabled: !!goalData?.goal,
  });

  const { data: recommendations } = useQuery<{
    recommendations: CreditRecommendation[];
    currentScore: number;
    targetScore: number;
  }>({
    queryKey: homeownershipGoalKeys.creditRecommendations(),
    enabled: !!goalData?.goal,
  });

  // <input, context, output>: the fields hold what the DOM gives us, while
  // `handleSubmit` hands `onSubmitGoal` the resolver-coerced numbers.
  const form = useForm<GoalFormInput, unknown, GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: {
      currentCreditScore: 600,
      monthlyIncome: 5000,
      monthlyDebts: 500,
      currentRent: 1500,
      currentSavingsBalance: 0,
      currentMonthlySavings: 300,
      targetHomePrice: 350000,
      targetDownPayment: 17500,
      targetCity: "",
      targetState: "",
    },
  });

  useEffect(() => {
    if (goalData?.goal && showOnboarding) {
      const goal = goalData.goal;
      form.reset({
        currentCreditScore: goal.currentCreditScore || 600,
        monthlyIncome: parseFloat(goal.monthlyIncome?.toString() || "5000"),
        monthlyDebts: parseFloat(goal.monthlyDebts?.toString() || "500"),
        currentRent: parseFloat(goal.currentRent?.toString() || "1500"),
        currentSavingsBalance: parseFloat(goal.currentSavingsBalance?.toString() || "0"),
        currentMonthlySavings: parseFloat(goal.currentMonthlySavings?.toString() || "300"),
        targetHomePrice: parseFloat(goal.targetHomePrice?.toString() || "350000"),
        targetDownPayment: parseFloat(goal.targetDownPayment?.toString() || "17500"),
        targetCity: goal.targetCity || "",
        targetState: goal.targetState || "",
      });
    }
  }, [goalData?.goal, showOnboarding, form]);

  const createGoalMutation = useMutation({
    mutationFn: async (data: GoalFormValues) => {
      const payload = {
        currentCreditScore: data.currentCreditScore,
        monthlyIncome: String(data.monthlyIncome),
        monthlyDebts: String(data.monthlyDebts),
        currentRent: String(data.currentRent),
        currentSavingsBalance: String(data.currentSavingsBalance),
        currentMonthlySavings: String(data.currentMonthlySavings),
        targetHomePrice: String(data.targetHomePrice),
        targetDownPayment: String(data.targetDownPayment),
        targetCity: data.targetCity || undefined,
        targetState: data.targetState || undefined,
      };
      const response = await apiRequest("POST", "/api/homeownership-goal", payload);
      return response.json();
    },
    onSuccess: () => {
      // One prefix covers the goal AND both derived views. Enumerating them by
      // hand is what left credit-recommendations stale after a goal change.
      queryClient.invalidateQueries({ queryKey: homeownershipGoalKeys.all() });
      setShowOnboarding(false);
      toast({
        title: "Journey Started!",
        description: "Your homeownership journey has begun. Let's reach your goals together!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start your journey. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: async (data: Partial<GoalFormValues>) => {
      const payload: Record<string, string | number | undefined> = {};
      if (data.currentCreditScore !== undefined) payload.currentCreditScore = data.currentCreditScore;
      if (data.monthlyIncome !== undefined) payload.monthlyIncome = String(data.monthlyIncome);
      if (data.monthlyDebts !== undefined) payload.monthlyDebts = String(data.monthlyDebts);
      if (data.currentRent !== undefined) payload.currentRent = String(data.currentRent);
      if (data.currentSavingsBalance !== undefined) payload.currentSavingsBalance = String(data.currentSavingsBalance);
      if (data.currentMonthlySavings !== undefined) payload.currentMonthlySavings = String(data.currentMonthlySavings);
      if (data.targetHomePrice !== undefined) payload.targetHomePrice = String(data.targetHomePrice);
      if (data.targetDownPayment !== undefined) payload.targetDownPayment = String(data.targetDownPayment);
      if (data.targetCity !== undefined) payload.targetCity = data.targetCity;
      if (data.targetState !== undefined) payload.targetState = data.targetState;
      const response = await apiRequest("PATCH", "/api/homeownership-goal", payload);
      return response.json();
    },
    onSuccess: () => {
      // One prefix covers the goal AND both derived views. Enumerating them by
      // hand is what left credit-recommendations stale after a goal change.
      queryClient.invalidateQueries({ queryKey: homeownershipGoalKeys.all() });
      toast({
        title: "Updated",
        description: "Your financial information has been updated.",
      });
    },
    // Silent before: an edit to income, debts, savings or the target price
    // simply vanished, with the stale figures still on screen — so the borrower
    // had no way to tell the number they were reading was not the one they had
    // just entered.
    onError: (error: Error) => {
      toast({
        title: "Changes not saved",
        description: error.message || "We couldn't update your goal. The figures shown are the previously saved ones — please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmitGoal = (data: GoalFormValues) => {
    if (goalData?.goal) {
      updateGoalMutation.mutate(data);
      setShowOnboarding(false);
    } else {
      createGoalMutation.mutate(data);
    }
  };

  if (goalLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // A server failure on the goal query used to render the "set up your goal"
  // onboarding form as if the user had none — misleading, and it re-prompts users
  // who already have a goal. Show an honest error + retry first (ux-01).
  if (goalIsError) {
    return (
      <div className="container max-w-3xl mx-auto py-8 px-4">
        <QueryErrorState
          error={goalErrorObj}
          onRetry={() => refetchGoal()}
          title="We couldn't load your homeownership goal"
          data-testid="gap-error"
        />
      </div>
    );
  }

  if (!goalData?.goal || showOnboarding) {
    return (
      <GapGoalOnboardingForm
        form={form}
        onSubmit={onSubmitGoal}
        onCancel={goalData?.goal ? () => setShowOnboarding(false) : undefined}
        isSubmitting={createGoalMutation.isPending || updateGoalMutation.isPending}
        isUpdate={!!goalData?.goal}
      />
    );
  }

  const analysis = gapAnalysis?.analysis;

  return (
    <PageShell width="wide" className="space-y-6">
      <PresalesDisclaimer />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Gap to Homeownership</h1>
          <p className="text-muted-foreground">
            Day {analysis?.overall.journeyDay || 1} of your journey
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={analysis?.overall.goalsComplete ? "default" : "secondary"}>
            {analysis?.overall.phase === "discovery" && "Discovery Phase"}
            {analysis?.overall.phase === "credit_cleanup" && "Credit Cleanup"}
            {analysis?.overall.phase === "saving" && "Saving Phase"}
            {analysis?.overall.phase === "ready" && "Goals Complete"}
          </Badge>
          <Button
            variant="outline"
            size="sm" className="touch-target"
            onClick={() => setShowOnboarding(true)}
            data-testid="button-update-info"
          >
            Update Info
          </Button>
        </div>
      </div>

      {analysis?.overall.goalsComplete && (
        <Card className="border-border bg-success-subtle">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-success-subtle">
                <CheckCircle2 className="h-8 w-8 text-success-subtle-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-success-subtle-foreground">
                  Goals Complete
                </h3>
                <p className="text-success-subtle-foreground">
                  Your credit and savings goals have been met. You can now proceed with your mortgage application.
                </p>
              </div>
              {/* The card above tells the borrower they can proceed with their
                  application, so this has to take them there. It carried no
                  onClick, no asChild and no link (#513), which made the one
                  call to action on a completed goal plan do nothing. Same
                  pattern and destination as BuyerProperties' "Apply Now". */}
              <Button asChild className="ml-auto" data-testid="button-apply-now">
                <Link href="/apply">
                  Apply Now <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <StatsCards analysis={analysis} />

      <Tabs defaultValue="credit" className="space-y-4">
        <TabsList>
          <TabsTrigger value="credit" data-testid="tab-credit">Credit Coach</TabsTrigger>
          <TabsTrigger value="savings" data-testid="tab-savings">Savings Vault</TabsTrigger>
          <TabsTrigger value="roadmap" data-testid="tab-roadmap">30-Day Roadmap</TabsTrigger>
          <TabsTrigger value="milestones" data-testid="tab-milestones">Milestones</TabsTrigger>
        </TabsList>

        <TabsContent value="credit" className="space-y-4">
          <CreditCoachTab recommendations={recommendations?.recommendations} />
        </TabsContent>

        <TabsContent value="savings" className="space-y-4">
          <SavingsVaultTab analysis={analysis} savingsTransactions={goalData?.savingsTransactions} />
        </TabsContent>

        <TabsContent value="roadmap" className="space-y-4">
          <RoadmapTab analysis={analysis} milestonesCount={goalData?.milestones?.length || 0} />
        </TabsContent>

        <TabsContent value="milestones" className="space-y-4">
          <MilestonesTab milestones={goalData?.milestones} />
        </TabsContent>
      </Tabs>

      <ApplyCtaCard />
    </PageShell>
  );
}
