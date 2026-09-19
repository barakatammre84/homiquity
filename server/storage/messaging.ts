// Storage domain: Referral links, team messaging, presence, document-request integration.
// One link in the DatabaseStorage inheritance chain — see ./index.ts.
import { db } from "../db";
import {
  eq,
  desc,
  and,
  sql,
  or,
  asc,
  inArray,
} from "drizzle-orm";
// SSN uses ssnVault (canonical, from main); account numbers use piiVault (this
// branch — main leaves account numbers plaintext).

import {
  users,
  loanApplications,
  dealTeamMembers,
  teamMessages,
  isStaffRole,
  LOAN_APP_STATUSES,
  isTerminalLoanAppStatus,
  type User,
  type TeamMessage,
  type InsertTeamMessage,
} from "@shared/schema";
import { canonicalDocumentType } from "@shared/documentTypes";
import {
  findOpenDocumentRequest,
  isOpenDocumentRequest,
} from "../services/documentRequestWorkflow";
import { OpsAnalyticsStorage } from "./opsAnalytics";
export class MessagingStorage extends OpsAnalyticsStorage {
  // ============================================
  // Referral Link System Methods
  // ============================================
  
  async generateReferralCode(userId: string): Promise<string> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    
    // If user already has a referral code, return it
    if (user.referralCode) {
      return user.referralCode;
    }
    
    // Generate a unique code based on name and random suffix
    const baseName = `${user.firstName || 'LO'}-${user.lastName || 'USER'}`.toUpperCase().replace(/[^A-Z]/g, '');
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const referralCode = `${baseName.substring(0, 8)}-${suffix}`;
    
    // Save to user
    await db.update(users).set({ referralCode }).where(eq(users.id, userId));
    
    return referralCode;
  }
  
  async getUserByReferralCode(referralCode: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, referralCode));
    return user;
  }
  
  async setUserReferredBy(userId: string, referringUserId: string): Promise<void> {
    await db.update(users).set({ referredByUserId: referringUserId }).where(eq(users.id, userId));
  }
  
  async getReferralsByUser(userId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.referredByUserId, userId));
  }
  
  async getReferralStats(userId: string): Promise<{
    totalReferrals: number;
    referralsThisMonth: number;
    activeApplications: number;
    closedLoans: number;
  }> {
    // Get all users referred by this user
    const referredUsers = await this.getReferralsByUser(userId);
    const referredUserIds = referredUsers.map(u => u.id);
    
    if (referredUserIds.length === 0) {
      return { totalReferrals: 0, referralsThisMonth: 0, activeApplications: 0, closedLoans: 0 };
    }
    
    // Count referrals this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const referralsThisMonth = referredUsers.filter(u => 
      u.createdAt && new Date(u.createdAt) >= startOfMonth
    ).length;
    
    // Get applications from referred users. `inArray` — not a raw
    // `= ANY(${array})`: drizzle binds an embedded array as a parenthesised
    // parameter list, so the emitted `ANY(($1))` handed Postgres a bare uuid
    // and every LO with at least one referral got 22P02 "malformed array
    // literal" (a 500 the referral rail rendered as four zeros).
    const applications = await db.select()
      .from(loanApplications)
      .where(inArray(loanApplications.userId, referredUserIds));
    
    // Same active/terminal split as brokerReferrals.getBrokerReferralStats —
    // derived from the canonical vocabulary, not hand-listed.
    const activeStatuses = LOAN_APP_STATUSES.filter(s => !isTerminalLoanAppStatus(s)) as string[];
    const activeApplications = applications.filter(app => activeStatuses.includes(app.status)).length;
    const closedLoans = applications.filter(app => app.status === 'funded').length;
    
    return {
      totalReferrals: referredUsers.length,
      referralsThisMonth,
      activeApplications,
      closedLoans,
    };
  }

  // ============================================
  // Team Messaging Methods
  // ============================================
  
  async sendMessage(data: InsertTeamMessage): Promise<TeamMessage> {
    const [message] = await db.insert(teamMessages).values(data).returning();
    return message;
  }

  /**
   * Send one open request for a document type on a loan file. The transaction
   * lock makes two staff tabs racing the same ask converge on the first row.
   */
  async sendDocumentRequestOnce(
    data: InsertTeamMessage & { applicationId: string },
  ): Promise<{ message: TeamMessage; created: boolean }> {
    return db.transaction(async (transaction) => {
      const requestData = data.documentRequestData as {
        documentType?: string;
        status?: string;
      } | null;
      if (!requestData?.documentType) throw new Error("Document request data is required");
      const documentType = canonicalDocumentType(requestData.documentType);
      const lockKey = [data.applicationId, data.recipientId, documentType].join(":");
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const candidates = await transaction
        .select()
        .from(teamMessages)
        .where(
          and(
            eq(teamMessages.applicationId, data.applicationId),
            eq(teamMessages.recipientId, data.recipientId),
            eq(teamMessages.messageType, "document_request"),
          ),
        )
        .orderBy(desc(teamMessages.createdAt));
      const existing = findOpenDocumentRequest(candidates, {
        applicationId: data.applicationId,
        recipientId: data.recipientId,
        documentType,
      });
      if (existing) return { message: existing, created: false };
      const [message] = await transaction
        .insert(teamMessages)
        .values({
          ...data,
          documentRequestData: { ...requestData, documentType },
        })
        .returning();
      return { message, created: true };
    });
  }

  async getMessageById(messageId: string): Promise<TeamMessage | null> {
    const [message] = await db.select().from(teamMessages).where(eq(teamMessages.id, messageId)).limit(1);
    return message ?? null;
  }

  async getOpenDocumentRequestsForApplication(
    applicationId: string,
    recipientId: string,
  ): Promise<TeamMessage[]> {
    const rows = await db
      .select()
      .from(teamMessages)
      .where(
        and(
          eq(teamMessages.applicationId, applicationId),
          eq(teamMessages.recipientId, recipientId),
          eq(teamMessages.messageType, "document_request"),
        ),
      )
      .orderBy(desc(teamMessages.createdAt));
    return rows.filter(isOpenDocumentRequest);
  }

  async getMessages(userId: string, otherUserId: string): Promise<TeamMessage[]> {
    return db.select()
      .from(teamMessages)
      .where(
        or(
          and(
            eq(teamMessages.senderId, userId),
            eq(teamMessages.recipientId, otherUserId)
          ),
          and(
            eq(teamMessages.senderId, otherUserId),
            eq(teamMessages.recipientId, userId)
          )
        )
      )
      .orderBy(asc(teamMessages.createdAt));
  }

  /**
   * Resolve message application visibility in one query. Conversation history
   * remains participant-visible, but callers use this set to withhold review
   * details written after loan-file access is removed.
   */
  async getAccessibleMessageApplicationIds(
    userId: string,
    userRole: string,
    applicationIds: string[],
  ): Promise<string[]> {
    const uniqueIds = [...new Set(applicationIds)];
    if (uniqueIds.length === 0) return [];
    if (userRole === "admin") return uniqueIds;

    if (isStaffRole(userRole)) {
      const rows = await db
        .select({ applicationId: dealTeamMembers.applicationId })
        .from(dealTeamMembers)
        .where(and(
          inArray(dealTeamMembers.applicationId, uniqueIds),
          eq(dealTeamMembers.userId, userId),
          eq(dealTeamMembers.isActive, true),
        ));
      return [...new Set(rows.map((row) => row.applicationId))];
    }

    const rows = await db
      .select({ id: loanApplications.id })
      .from(loanApplications)
      .where(and(
        inArray(loanApplications.id, uniqueIds),
        eq(loanApplications.userId, userId),
      ));
    return rows.map((row) => row.id);
  }
  
  async getConversations(userId: string): Promise<{
    partnerId: string;
    lastMessage: TeamMessage;
    unreadCount: number;
  }[]> {
    // Get all messages involving the user
    const messages = await db.select()
      .from(teamMessages)
      .where(
        or(
          eq(teamMessages.senderId, userId),
          eq(teamMessages.recipientId, userId)
        )
      )
      .orderBy(desc(teamMessages.createdAt));
    
    // Group by conversation partner
    const conversationMap = new Map<string, { lastMessage: TeamMessage; unreadCount: number }>();
    
    for (const msg of messages) {
      const partnerId = msg.senderId === userId ? msg.recipientId : msg.senderId;
      
      if (!conversationMap.has(partnerId)) {
        // Count unread messages from this partner
        const unreadCount = messages.filter(
          m => m.senderId === partnerId && m.recipientId === userId && !m.isRead
        ).length;
        
        conversationMap.set(partnerId, {
          lastMessage: msg,
          unreadCount,
        });
      }
    }
    
    return Array.from(conversationMap.entries()).map(([partnerId, data]) => ({
      partnerId,
      ...data,
    }));
  }
  
  async markMessagesAsRead(userId: string, senderId: string): Promise<void> {
    await db.update(teamMessages)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(teamMessages.recipientId, userId),
          eq(teamMessages.senderId, senderId),
          eq(teamMessages.isRead, false)
        )
      );
  }
  
  async getUnreadMessageCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(teamMessages)
      .where(
        and(
          eq(teamMessages.recipientId, userId),
          eq(teamMessages.isRead, false)
        )
      );
    return result[0]?.count || 0;
  }
  
  async getStaffUsersForTeamDisplay(): Promise<User[]> {
    // Get all staff users who can be part of a borrower's team
    return db.select()
      .from(users)
      .where(
        or(
          eq(users.role, 'lo'),
          eq(users.role, 'loa'),
          eq(users.role, 'processor'),
          eq(users.role, 'underwriter'),
          eq(users.role, 'closer'),
          eq(users.role, 'admin')
        )
      );
  }
  
  // ============================================
  // Presence Tracking Methods
  // ============================================
  
  async updateUserPresence(userId: string): Promise<void> {
    await db.update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.id, userId));
  }
  
  async getUserPresenceStatus(userId: string): Promise<'online' | 'away' | 'offline'> {
    const [user] = await db.select({ lastActiveAt: users.lastActiveAt })
      .from(users)
      .where(eq(users.id, userId));
    
    if (!user?.lastActiveAt) return 'offline';
    
    const now = new Date();
    const lastActive = new Date(user.lastActiveAt);
    const diffMinutes = (now.getTime() - lastActive.getTime()) / 60000;
    
    if (diffMinutes < 2) return 'online';
    if (diffMinutes < 10) return 'away';
    return 'offline';
  }
  
  private attachPresence(users: User[]): (User & { presenceStatus: 'online' | 'away' | 'offline' })[] {
    const now = new Date();
    return users.map(user => {
      let presenceStatus: 'online' | 'away' | 'offline' = 'offline';
      if (user.lastActiveAt) {
        const diffMinutes = (now.getTime() - new Date(user.lastActiveAt).getTime()) / 60000;
        if (diffMinutes < 2) presenceStatus = 'online';
        else if (diffMinutes < 10) presenceStatus = 'away';
      }
      return { ...user, presenceStatus };
    });
  }

  async getTeamMembersWithPresence(): Promise<(User & { presenceStatus: 'online' | 'away' | 'offline' })[]> {
    // Staff-facing / internal view: all staff (used for internal coordination).
    return this.attachPresence(await this.getStaffUsersForTeamDisplay());
  }

  /**
   * A borrower's OWN loan team — the staff actually assigned to their
   * application(s): deal-team members plus assigned loan officers. Scoping the
   * borrower's Messages view to this set stops them from browsing (and DMing)
   * the entire staff directory.
   *
   * Fallback: a borrower with no assigned team yet (common pre-assignment) gets
   * the full staff list so they are never left with no one to contact.
   */
  async getTeamMembersForBorrower(
    borrowerUserId: string,
  ): Promise<(User & { presenceStatus: 'online' | 'away' | 'offline' })[]> {
    const apps = await this.getLoanApplicationsByUser(borrowerUserId);
    const staffIds = new Set<string>();

    for (const app of apps) {
      if (app.loanOfficerId) staffIds.add(app.loanOfficerId);
      const team = await this.getDealTeamMembers(app.id);
      for (const m of team) {
        if (m.userId && isStaffRole(m.user?.role ?? "")) staffIds.add(m.userId);
      }
    }

    if (staffIds.size === 0) {
      // No team assigned yet — don't strand the borrower.
      return this.getTeamMembersWithPresence();
    }

    const members = await Promise.all([...staffIds].map((id) => this.getUser(id)));
    return this.attachPresence(members.filter((u): u is User => !!u));
  }

  /** True when this staff user is on the borrower's team (or none is assigned). */
  async isStaffOnBorrowerTeam(borrowerUserId: string, staffUserId: string): Promise<boolean> {
    const team = await this.getTeamMembersForBorrower(borrowerUserId);
    return team.some((m) => m.id === staffUserId);
  }
  
  // ============================================
  // Document Request Integration
  // ============================================
  
  async getPendingDocumentRequests(userId: string): Promise<TeamMessage[]> {
    const messages = await db.select()
      .from(teamMessages)
      .where(
        and(
          eq(teamMessages.recipientId, userId),
          eq(teamMessages.messageType, 'document_request')
        )
      )
      .orderBy(desc(teamMessages.createdAt));
    
    // Rejected requests are actionable again: the borrower must upload the
    // corrected replacement. Keep them in this legacy "pending" feed until
    // the replacement is submitted so dashboard badges do not disappear at
    // the moment action is most urgent.
    return messages.filter(msg => {
      const data = msg.documentRequestData as any;
      const status = data?.status ?? "pending";
      return status === "pending" || status === "rejected";
    });
  }

}
