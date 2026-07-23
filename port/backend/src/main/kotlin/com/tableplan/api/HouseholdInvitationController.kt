package com.tableplan.api

import com.tableplan.tenant.HouseholdInvitationService
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

data class CreateInvitationRequest(
    @field:Email val email: String,
    @field:NotBlank val role: String = "viewer",
    @field:NotBlank val relationship: String = "other",
)

@RestController
class HouseholdInvitationController(
    private val invitations: HouseholdInvitationService,
) {
    @GetMapping("/api/v1/household/invitations")
    fun list(authentication: Authentication) = invitations.list(authentication.principal())

    @PostMapping("/api/v1/household/invitations")
    fun create(@Valid @RequestBody body: CreateInvitationRequest, authentication: Authentication) =
        invitations.create(authentication.principal(), body.email, body.role, body.relationship)

    @GetMapping("/api/public/household-invitations/{token}")
    fun inspect(@PathVariable token: String) = invitations.inspect(token)

    @PostMapping("/api/v1/household-invitations/{token}/accept")
    fun accept(@PathVariable token: String, authentication: Authentication) =
        mapOf("householdId" to invitations.accept(authentication.principal(), token))

    @DeleteMapping("/api/v1/household/invitations/{id}")
    fun revoke(@PathVariable id: String, authentication: Authentication) =
        mapOf("revoked" to invitations.revoke(authentication.principal(), id))
}
