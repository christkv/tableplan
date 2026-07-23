package com.tableplan.auth

import java.security.Principal

data class TableplanPrincipal(
    val userId: String,
    val householdId: String,
    val authenticationKind: AuthenticationKind,
    val scopes: Set<String> = emptySet(),
) : Principal {
    override fun getName(): String = userId
}

enum class AuthenticationKind {
    SESSION,
    API_KEY,
    PUBLIC_SHARE,
    INVITATION_TOKEN,
}

