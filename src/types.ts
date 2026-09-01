export type AppRole = "MASTER_ADMIN" | "COACH" | "CLIENT";

export type Client = {
  uid: string;
  relationshipId: string;
  status: string;
  paymentAlertsEnabled: boolean;
  name: string;
  email?: string;
  onboardingStatus?: string;
  timezone?: string;
};

export type PlanDay = {
  id: string;
  date: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  comment: string | null;
  recommendations: string | null;
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};
