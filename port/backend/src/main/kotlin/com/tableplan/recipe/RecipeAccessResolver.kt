package com.tableplan.recipe

import com.tableplan.auth.TableplanPrincipal
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Component

@Component
class RecipeAccessResolver {
    fun resolve(authentication: Authentication?): RecipeAccess {
        val principal = authentication?.principal as? TableplanPrincipal
        if (principal != null) return RecipeAccess(principal.userId, principal.householdId)
        val userId =
            authentication
                ?.takeIf { it.isAuthenticated && it.name != "anonymousUser" }
                ?.name
                ?: "__anonymous__"
        return RecipeAccess(userId = userId, householdId = "__anonymous__")
    }
}
