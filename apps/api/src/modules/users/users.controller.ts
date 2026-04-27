import { Controller, Get, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() currentUser: AuthenticatedUser) {
    const user = await this.usersService.findByClerkId(currentUser.id);
    
    if (!user) {
      throw new NotFoundException('User profile not found in database');
    }

    // Return the stable local user record
    return { user };
  }
}
