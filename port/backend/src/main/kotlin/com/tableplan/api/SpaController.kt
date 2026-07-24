package com.tableplan.api

import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping

@Controller
class SpaController {
    @GetMapping(
        value = [
            "/",
            "/sign-in",
            "/login",
            "/register",
            "/verify-email",
            "/forgot-password",
            "/reset-password",
            "/auth/error",
            "/household/join",
            "/shared/shopping",
            "/shared/shopping/{shareId}",
            "/recipes",
            "/recipes/new",
            "/recipes/import",
            "/recipes/import/{ingestionId}",
            "/recipes/{recipeId}/edit",
            "/recipes/{recipeId}",
            "/favorites",
            "/plan",
            "/shopping",
            "/settings",
        ],
    )
    fun index() = "forward:/index.html"
}
