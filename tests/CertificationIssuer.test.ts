// tests/CertificationIssuer.test.ts

import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Certification {
  teacher: string;
  certificationType: string;
  issueDate: number;
  expirationDate: number;
  status: string;
  prerequisites: string[];
  metadata: string;
  renewalCount: number;
}

interface CertificationRequirement {
  requiredCPDHours: number;
  requiredActivities: string[];
  validityPeriod: number;
}

interface ContractState {
  certifications: Map<string, Certification>; // Key: certificationId (teacher + type)
  requirements: Map<string, CertificationRequirement>; // Key: certificationType
  admins: Map<string, boolean>;
  verifiers: Map<string, boolean>;
  paused: boolean;
  certificationCounter: number;
  revocationLogs: Map<string, { reason: string; timestamp: number }>; // Key: certificationId
}

// Mock contract implementation
class CertificationIssuerMock {
  private state: ContractState = {
    certifications: new Map(),
    requirements: new Map(),
    admins: new Map([["deployer", true]]),
    verifiers: new Map(),
    paused: false,
    certificationCounter: 0,
    revocationLogs: new Map(),
  };

  private MAX_METADATA_LEN = 500;
  private ERR_UNAUTHORIZED = 100;
  private ERR_PAUSED = 101;
  private ERR_INVALID_TEACHER = 102;
  private ERR_INVALID_TYPE = 103;
  private ERR_REQUIREMENTS_NOT_MET = 104;
  private ERR_ALREADY_CERTIFIED = 105;
  private ERR_METADATA_TOO_LONG = 106;
  private ERR_NOT_EXPIRED = 107;
  private ERR_NOT_FOUND = 108;
  private ERR_INVALID_PERIOD = 109;
  private ERR_INVALID_STATUS = 110;

  // Read-only functions
  getCertification(certificationId: string): ClarityResponse<Certification | null> {
    return { ok: true, value: this.state.certifications.get(certificationId) ?? null };
  }

  getRequirements(certificationType: string): ClarityResponse<CertificationRequirement | null> {
    return { ok: true, value: this.state.requirements.get(certificationType) ?? null };
  }

  isAdmin(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.admins.get(account) ?? false };
  }

  isVerifier(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.verifiers.get(account) ?? false };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getRevocationLog(certificationId: string): ClarityResponse<{ reason: string; timestamp: number } | null> {
    return { ok: true, value: this.state.revocationLogs.get(certificationId) ?? null };
  }

  // Admin functions
  addAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.state.admins.has(newAdmin)) {
      return { ok: false, value: this.ERR_ALREADY_CERTIFIED }; // Reuse error for "already exists"
    }
    this.state.admins.set(newAdmin, true);
    return { ok: true, value: true };
  }

  removeAdmin(caller: string, admin: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (admin === "deployer") {
      return { ok: false, value: this.ERR_UNAUTHORIZED }; // Can't remove deployer
    }
    this.state.admins.delete(admin);
    return { ok: true, value: true };
  }

  addVerifier(caller: string, verifier: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.verifiers.set(verifier, true);
    return { ok: true, value: true };
  }

  removeVerifier(caller: string, verifier: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.verifiers.delete(verifier);
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  setRequirements(
    caller: string,
    certificationType: string,
    requiredCPDHours: number,
    requiredActivities: string[],
    validityPeriod: number
  ): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (validityPeriod <= 0) {
      return { ok: false, value: this.ERR_INVALID_PERIOD };
    }
    this.state.requirements.set(certificationType, {
      requiredCPDHours,
      requiredActivities,
      validityPeriod,
    });
    return { ok: true, value: true };
  }

  // Core functions
  issueCertification(
    caller: string,
    teacher: string,
    certificationType: string,
    prerequisites: string[],
    metadata: string
  ): ClarityResponse<string> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.admins.get(caller) && !this.state.verifiers.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (teacher === "") {
      return { ok: false, value: this.ERR_INVALID_TEACHER };
    }
    if (certificationType === "") {
      return { ok: false, value: this.ERR_INVALID_TYPE };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const certificationId = `${teacher}-${certificationType}`;
    if (this.state.certifications.has(certificationId)) {
      const existing = this.state.certifications.get(certificationId)!;
      if (existing.status === "active") {
        return { ok: false, value: this.ERR_ALREADY_CERTIFIED };
      }
    }
    const requirements = this.state.requirements.get(certificationType);
    if (!requirements) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    // Mock prerequisite check - in real would call CPDLogger
    if (prerequisites.length < requirements.requiredActivities.length) {
      return { ok: false, value: this.ERR_REQUIREMENTS_NOT_MET };
    }
    const now = Date.now();
    this.state.certifications.set(certificationId, {
      teacher,
      certificationType,
      issueDate: now,
      expirationDate: now + requirements.validityPeriod * 86400000, // days to ms
      status: "active",
      prerequisites,
      metadata,
      renewalCount: 0,
    });
    this.state.certificationCounter++;
    return { ok: true, value: certificationId };
  }

  renewCertification(
    caller: string,
    certificationId: string,
    additionalPrerequisites: string[]
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.admins.get(caller) && !this.state.verifiers.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const cert = this.state.certifications.get(certificationId);
    if (!cert) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (cert.status !== "expired") {
      return { ok: false, value: this.ERR_NOT_EXPIRED };
    }
    const requirements = this.state.requirements.get(cert.certificationType);
    if (!requirements) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    // Mock check
    if (additionalPrerequisites.length < requirements.requiredActivities.length / 2) {
      return { ok: false, value: this.ERR_REQUIREMENTS_NOT_MET };
    }
    const now = Date.now();
    this.state.certifications.set(certificationId, {
      ...cert,
      issueDate: now,
      expirationDate: now + requirements.validityPeriod * 86400000,
      status: "active",
      prerequisites: [...cert.prerequisites, ...additionalPrerequisites],
      renewalCount: cert.renewalCount + 1,
    });
    return { ok: true, value: true };
  }

  revokeCertification(caller: string, certificationId: string, reason: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const cert = this.state.certifications.get(certificationId);
    if (!cert) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (cert.status === "revoked") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    this.state.certifications.set(certificationId, {
      ...cert,
      status: "revoked",
    });
    this.state.revocationLogs.set(certificationId, {
      reason,
      timestamp: Date.now(),
    });
    return { ok: true, value: true };
  }

  verifyCertification(certificationId: string): ClarityResponse<boolean> {
    const cert = this.state.certifications.get(certificationId);
    if (!cert) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    const now = Date.now();
    const isValid = cert.status === "active" && cert.expirationDate > now;
    return { ok: isValid, value: isValid ? true : this.ERR_INVALID_STATUS };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  admin: "admin_1",
  verifier: "verifier_1",
  teacher1: "teacher_1",
  teacher2: "teacher_2",
};

describe("CertificationIssuer Contract", () => {
  let contract: CertificationIssuerMock;

  beforeEach(() => {
    contract = new CertificationIssuerMock();
  });

  it("should initialize with default state", () => {
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
    expect(contract.isAdmin(accounts.deployer)).toEqual({ ok: true, value: true });
    expect(contract.getCertification("nonexistent")).toEqual({ ok: true, value: null });
  });

  it("should allow admin to add another admin", () => {
    const addAdmin = contract.addAdmin(accounts.deployer, accounts.admin);
    expect(addAdmin).toEqual({ ok: true, value: true });
    expect(contract.isAdmin(accounts.admin)).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding admin", () => {
    const addAdmin = contract.addAdmin(accounts.teacher1, accounts.admin);
    expect(addAdmin).toEqual({ ok: false, value: 100 });
  });

  it("should allow admin to set certification requirements", () => {
    const setReq = contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );
    expect(setReq).toEqual({ ok: true, value: true });
    const req = contract.getRequirements("basic-teaching");
    expect(req).toEqual({
      ok: true,
      value: {
        requiredCPDHours: 40,
        requiredActivities: ["workshop", "online-course"],
        validityPeriod: 365,
      },
    });
  });

  it("should prevent invalid validity period in requirements", () => {
    const setReq = contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop"],
      0
    );
    expect(setReq).toEqual({ ok: false, value: 109 });
  });

  it("should allow verifier to issue certification after setting requirements", () => {
    contract.addVerifier(accounts.deployer, accounts.verifier);
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.verifier,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      "Issued for excellent performance"
    );
    expect(issue.ok).toBe(true);
    const certId = issue.value as string;
    const cert = contract.getCertification(certId);
    expect(cert).toEqual({
      ok: true,
      value: expect.objectContaining({
        teacher: accounts.teacher1,
        certificationType: "basic-teaching",
        status: "active",
        prerequisites: ["workshop", "online-course"],
        renewalCount: 0,
      }),
    });
  });

  it("should prevent issuance if prerequisites not met", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop"],
      "Incomplete prereqs"
    );
    expect(issue).toEqual({ ok: false, value: 104 });
  });

  it("should prevent issuance with too long metadata", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const longMetadata = "a".repeat(501);
    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      longMetadata
    );
    expect(issue).toEqual({ ok: false, value: 106 });
  });

  it("should allow renewal of expired certification", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      "Initial issue"
    );
    const certId = issue.value as string;

    // Mock expiration by setting expiration to past
    const cert = contract.state.certifications.get(certId)!;
    cert.expirationDate = Date.now() - 1000;
    cert.status = "expired";
    contract.state.certifications.set(certId, cert);

    const renew = contract.renewCertification(
      accounts.deployer,
      certId,
      ["advanced-workshop"]
    );
    expect(renew).toEqual({ ok: true, value: true });

    const updatedCert = contract.getCertification(certId);
    expect(updatedCert).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: "active",
        renewalCount: 1,
        prerequisites: ["workshop", "online-course", "advanced-workshop"],
      }),
    });
  });

  it("should prevent renewal if not expired", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      "Initial"
    );
    const certId = issue.value as string;

    const renew = contract.renewCertification(
      accounts.deployer,
      certId,
      ["advanced"]
    );
    expect(renew).toEqual({ ok: false, value: 107 });
  });

  it("should allow admin to revoke certification", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      "To revoke"
    );
    const certId = issue.value as string;

    const revoke = contract.revokeCertification(
      accounts.deployer,
      certId,
      "Violation of terms"
    );
    expect(revoke).toEqual({ ok: true, value: true });

    const cert = contract.getCertification(certId);
    expect(cert).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "revoked" }),
    });

    const log = contract.getRevocationLog(certId);
    expect(log).toEqual({
      ok: true,
      value: expect.objectContaining({ reason: "Violation of terms" }),
    });
  });

  it("should prevent non-admin from revoking", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      "No revoke"
    );
    const certId = issue.value as string;

    const revoke = contract.revokeCertification(
      accounts.teacher2,
      certId,
      "Unauthorized"
    );
    expect(revoke).toEqual({ ok: false, value: 100 });
  });

  it("should verify active certification", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      "Valid"
    );
    const certId = issue.value as string;

    const verify = contract.verifyCertification(certId);
    expect(verify).toEqual({ ok: true, value: true });
  });

  it("should fail verification for expired certification", () => {
    contract.setRequirements(
      accounts.deployer,
      "basic-teaching",
      40,
      ["workshop", "online-course"],
      365
    );

    const issue = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop", "online-course"],
      "Expired"
    );
    const certId = issue.value as string;

    // Mock expiration
    const cert = contract.state.certifications.get(certId)!;
    cert.expirationDate = Date.now() - 1000;
    cert.status = "expired";
    contract.state.certifications.set(certId, cert);

    const verify = contract.verifyCertification(certId);
    expect(verify).toEqual({ ok: false, value: 110 });
  });

  it("should pause and prevent operations", () => {
    const pause = contract.pauseContract(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const issueDuringPause = contract.issueCertification(
      accounts.deployer,
      accounts.teacher1,
      "basic-teaching",
      ["workshop"],
      "Paused"
    );
    expect(issueDuringPause).toEqual({ ok: false, value: 101 });

    const unpause = contract.unpauseContract(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });
});